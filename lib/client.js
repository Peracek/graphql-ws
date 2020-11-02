"use strict";
/**
 *
 * client
 *
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createClient = void 0;
const protocol_1 = require("./protocol");
const message_1 = require("./message");
const utils_1 = require("./utils");
/** Creates a disposable GraphQL subscriptions client. */
function createClient(options) {
    const { url, connectionParams, lazy = true, retryAttempts = 5, retryTimeout = 3 * 1000, // 3 seconds
    on, webSocketImpl, 
    /**
     * Generates a v4 UUID to be used as the ID using `Math`
     * as the random number generator. Supply your own generator
     * in case you need more uniqueness.
     *
     * Reference: https://stackoverflow.com/a/2117523/709884
     */
    generateID = function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0, v = c == 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }, } = options;
    let ws;
    if (webSocketImpl) {
        if (!isWebSocket(webSocketImpl)) {
            throw new Error('Invalid WebSocket implementation provided');
        }
        ws = webSocketImpl;
    }
    else if (typeof WebSocket !== 'undefined') {
        ws = WebSocket;
    }
    else if (typeof global !== 'undefined') {
        // @ts-expect-error: Support more browsers
        ws = global.WebSocket || global.MozWebSocket;
    }
    else if (typeof window !== 'undefined') {
        // @ts-expect-error: Support more browsers
        ws = window.WebSocket || window.MozWebSocket;
    }
    if (!ws) {
        throw new Error('WebSocket implementation missing');
    }
    const WebSocketImpl = ws;
    // websocket status emitter, subscriptions are handled differently
    const emitter = (() => {
        const listeners = {
            connecting: (on === null || on === void 0 ? void 0 : on.connecting) ? [on.connecting] : [],
            connected: (on === null || on === void 0 ? void 0 : on.connected) ? [on.connected] : [],
            closed: (on === null || on === void 0 ? void 0 : on.closed) ? [on.closed] : [],
        };
        return {
            on(event, listener) {
                const l = listeners[event];
                l.push(listener);
                return () => {
                    l.splice(l.indexOf(listener), 1);
                };
            },
            emit(event, ...args) {
                listeners[event].forEach((listener) => {
                    // @ts-expect-error: The args should fit
                    listener(...args);
                });
            },
            reset() {
                Object.keys(listeners).forEach((event) => {
                    listeners[event] = [];
                });
            },
        };
    })();
    let state = {
        socket: null,
        acknowledged: false,
        locks: 0,
        tries: 0,
    };
    async function connect(cancellerRef, callDepth = 0) {
        // prevents too many recursive calls when reavaluating/re-connecting
        if (callDepth > 10) {
            throw new Error('Kept trying to connect but the socket never settled.');
        }
        // socket already exists. can be ready or pending, check and behave accordingly
        if (state.socket) {
            switch (state.socket.readyState) {
                case WebSocketImpl.OPEN: {
                    // if the socket is not acknowledged, wait a bit and reavaluate
                    if (!state.acknowledged) {
                        await new Promise((resolve) => setTimeout(resolve, 300));
                        return connect(cancellerRef, callDepth + 1);
                    }
                    return [
                        state.socket,
                        (cleanup) => new Promise((resolve, reject) => {
                            if (!state.socket) {
                                return reject(new Error('Socket closed unexpectedly'));
                            }
                            if (state.socket.readyState === WebSocketImpl.CLOSED) {
                                return reject(new Error('Socket has already been closed'));
                            }
                            state.locks++;
                            state.socket.addEventListener('close', listener);
                            function listener(event) {
                                var _a;
                                state.locks--;
                                (_a = state.socket) === null || _a === void 0 ? void 0 : _a.removeEventListener('close', listener);
                                return reject(event);
                            }
                            cancellerRef.current = () => {
                                var _a, _b;
                                cleanup === null || cleanup === void 0 ? void 0 : cleanup();
                                state.locks--;
                                if (!state.locks) {
                                    (_a = state.socket) === null || _a === void 0 ? void 0 : _a.close(1000, 'Normal Closure');
                                }
                                (_b = state.socket) === null || _b === void 0 ? void 0 : _b.removeEventListener('close', listener);
                                return resolve();
                            };
                        }),
                    ];
                }
                case WebSocketImpl.CONNECTING: {
                    // if the socket is in the connecting phase, wait a bit and reavaluate
                    await new Promise((resolve) => setTimeout(resolve, 300));
                    return connect(cancellerRef, callDepth + 1);
                }
                case WebSocketImpl.CLOSED:
                    break; // just continue, we'll make a new one
                case WebSocketImpl.CLOSING: {
                    // if the socket is in the closing phase, wait a bit and connect
                    await new Promise((resolve) => setTimeout(resolve, 300));
                    return connect(cancellerRef, callDepth + 1);
                }
                default:
                    throw new Error(`Impossible ready state ${state.socket.readyState}`);
            }
        }
        // establish connection and assign to singleton
        const socket = new WebSocketImpl(url, protocol_1.GRAPHQL_TRANSPORT_WS_PROTOCOL);
        state = Object.assign(Object.assign({}, state), { acknowledged: false, socket, tries: state.tries + 1 });
        emitter.emit('connecting');
        await new Promise((resolve, reject) => {
            let cancelled = false;
            cancellerRef.current = () => (cancelled = true);
            const tooLong = setTimeout(() => {
                socket.close(3408, 'Waited 5 seconds but socket connect never settled');
            }, 5 * 1000);
            /**
             * `onerror` handler is unnecessary because even if an error occurs, the `onclose` handler will be called
             *
             * From: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_client_applications
             * > If an error occurs while attempting to connect, first a simple event with the name error is sent to the
             * > WebSocket object (thereby invoking its onerror handler), and then the CloseEvent is sent to the WebSocket
             * > object (thereby invoking its onclose handler) to indicate the reason for the connection's closing.
             */
            socket.onclose = (event) => {
                socket.onclose = null;
                clearTimeout(tooLong);
                state = Object.assign(Object.assign({}, state), { acknowledged: false, socket: null });
                emitter.emit('closed', event);
                return reject(event);
            };
            socket.onmessage = (event) => {
                socket.onmessage = null;
                if (cancelled) {
                    socket.close(3499, 'Client cancelled the socket before connecting');
                    return;
                }
                try {
                    const message = message_1.parseMessage(event.data);
                    if (message.type !== message_1.MessageType.ConnectionAck) {
                        throw new Error(`First message cannot be of type ${message.type}`);
                    }
                    clearTimeout(tooLong);
                    state = Object.assign(Object.assign({}, state), { acknowledged: true, socket, tries: 0 });
                    emitter.emit('connected', socket); // connected = socket opened + acknowledged
                    return resolve();
                }
                catch (err) {
                    socket.close(4400, err);
                }
            };
            // as soon as the socket opens, send the connection initalisation request
            socket.onopen = () => {
                socket.onopen = null;
                if (cancelled) {
                    socket.close(3499, 'Client cancelled the socket before connecting');
                    return;
                }
                socket.send(message_1.stringifyMessage({
                    type: message_1.MessageType.ConnectionInit,
                    payload: typeof connectionParams === 'function'
                        ? connectionParams()
                        : connectionParams,
                }));
            };
        });
        return [
            socket,
            (cleanup) => new Promise((resolve, reject) => {
                if (socket.readyState === WebSocketImpl.CLOSED) {
                    return reject(new Error('Socket has already been closed'));
                }
                state.locks++;
                socket.addEventListener('close', listener);
                function listener(event) {
                    state.locks--;
                    socket.removeEventListener('close', listener);
                    return reject(event);
                }
                cancellerRef.current = () => {
                    cleanup === null || cleanup === void 0 ? void 0 : cleanup();
                    state.locks--;
                    if (!state.locks) {
                        socket.close(1000, 'Normal Closure');
                    }
                    socket.removeEventListener('close', listener);
                    return resolve();
                };
            }),
        ];
    }
    // in non-lazy (hot?) mode always hold one connection lock to persist the socket
    if (!lazy) {
        (async () => {
            for (;;) {
                try {
                    const [, throwOnCloseOrWaitForCancel] = await connect({
                        current: null,
                    });
                    await throwOnCloseOrWaitForCancel();
                    // cancelled, shouldnt try again
                    return;
                }
                catch (errOrCloseEvent) {
                    // throw non `CloseEvent`s immediately, something else is wrong
                    if (!isCloseEvent(errOrCloseEvent)) {
                        throw errOrCloseEvent; // TODO-db-200909 promise is uncaught, will appear in console
                    }
                    // normal closure is disposal, shouldnt try again
                    if (errOrCloseEvent.code === 1000) {
                        return;
                    }
                    // retries are not allowed or we tried to many times, close for good
                    if (!retryAttempts || state.tries > retryAttempts) {
                        return;
                    }
                    // otherwize, wait a bit and retry
                    await new Promise((resolve) => setTimeout(resolve, retryTimeout));
                }
            }
        })();
    }
    // to avoid parsing the same message in each
    // subscriber, we memo one on the last received data
    let lastData, lastMessage;
    function memoParseMessage(data) {
        if (data !== lastData) {
            lastMessage = message_1.parseMessage(data);
            lastData = data;
        }
        return lastMessage;
    }
    return {
        on: emitter.on,
        subscribe(payload, sink) {
            const id = generateID();
            const cancellerRef = { current: null };
            const messageListener = ({ data }) => {
                const message = memoParseMessage(data);
                switch (message.type) {
                    case message_1.MessageType.Next: {
                        if (message.id === id) {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            sink.next(message.payload);
                        }
                        return;
                    }
                    case message_1.MessageType.Error: {
                        if (message.id === id) {
                            sink.error(message.payload);
                            // the canceller must be set at this point
                            // because you cannot receive a message
                            // if there is no existing connection
                            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                            cancellerRef.current();
                            // TODO-db-201025 calling canceller will complete the sink, meaning that both the `error` and `complete` will be
                            // called. neither promises or observables care; once they settle, additional calls to the resolvers will be ignored
                        }
                        return;
                    }
                    case message_1.MessageType.Complete: {
                        if (message.id === id) {
                            // the canceller must be set at this point
                            // because you cannot receive a message
                            // if there is no existing connection
                            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                            cancellerRef.current();
                            // calling canceller will complete the sink
                        }
                        return;
                    }
                }
            };
            (async () => {
                for (;;) {
                    try {
                        const [socket, throwOnCloseOrWaitForCancel] = await connect(cancellerRef);
                        socket.addEventListener('message', messageListener);
                        socket.send(message_1.stringifyMessage({
                            id: id,
                            type: message_1.MessageType.Subscribe,
                            payload,
                        }));
                        // either the canceller will be called and the promise resolved
                        // or the socket closed and the promise rejected
                        await throwOnCloseOrWaitForCancel(() => {
                            // send complete message to server on cancel
                            socket.send(message_1.stringifyMessage({
                                id: id,
                                type: message_1.MessageType.Complete,
                            }));
                        });
                        socket.removeEventListener('message', messageListener);
                        // cancelled, shouldnt try again
                        return;
                    }
                    catch (errOrCloseEvent) {
                        // throw non `CloseEvent`s immediately, something else is wrong
                        if (!isCloseEvent(errOrCloseEvent)) {
                            throw errOrCloseEvent;
                        }
                        // normal closure is disposal, shouldnt try again
                        if (errOrCloseEvent.code === 1000) {
                            return;
                        }
                        // user cancelled early, shouldnt try again
                        if (errOrCloseEvent.code === 3499) {
                            return;
                        }
                        // retries are not allowed or we tried to many times, close for good
                        if (!retryAttempts || state.tries > retryAttempts) {
                            throw errOrCloseEvent;
                        }
                        // otherwize, wait a bit and retry
                        await new Promise((resolve) => setTimeout(resolve, retryTimeout));
                    }
                }
            })()
                .catch(sink.error)
                .then(sink.complete) // resolves on cancel or normal closure
                .finally(() => (cancellerRef.current = null)); // when this promise settles there is nothing to cancel
            return () => {
                var _a;
                (_a = cancellerRef.current) === null || _a === void 0 ? void 0 : _a.call(cancellerRef);
            };
        },
        dispose() {
            var _a;
            (_a = state.socket) === null || _a === void 0 ? void 0 : _a.close(1000, 'Normal Closure');
            emitter.reset();
        },
    };
}
exports.createClient = createClient;
function isCloseEvent(val) {
    return utils_1.isObject(val) && 'code' in val && 'reason' in val && 'wasClean' in val;
}
function isWebSocket(val) {
    return (typeof val === 'function' &&
        'constructor' in val &&
        'CLOSED' in val &&
        'CLOSING' in val &&
        'CONNECTING' in val &&
        'OPEN' in val);
}
