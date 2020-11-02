"use strict";
/**
 *
 * server
 *
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServer = void 0;
const WebSocket = __importStar(require("ws"));
const graphql_1 = require("graphql");
const protocol_1 = require("./protocol");
const message_1 = require("./message");
const utils_1 = require("./utils");
/**
 * Creates a protocol complient WebSocket GraphQL
 * subscription server. Read more about the protocol
 * in the PROTOCOL.md documentation file.
 */
function createServer(options, websocketOptionsOrServer) {
    const isProd = process.env.NODE_ENV === 'production';
    const { schema, context, roots, execute, subscribe, connectionInitWaitTimeout = 3 * 1000, // 3 seconds
    keepAlive = 12 * 1000, // 12 seconds
    onConnect, onSubscribe, onOperation, onNext, onError, onComplete, } = options;
    const webSocketServer = isWebSocketServer(websocketOptionsOrServer)
        ? websocketOptionsOrServer
        : new WebSocket.Server(websocketOptionsOrServer);
    function handleConnection(socket, request) {
        if (socket.protocol === undefined ||
            socket.protocol !== protocol_1.GRAPHQL_TRANSPORT_WS_PROTOCOL ||
            (Array.isArray(socket.protocol) &&
                socket.protocol.indexOf(protocol_1.GRAPHQL_TRANSPORT_WS_PROTOCOL) === -1)) {
            return socket.close(1002, 'Protocol Error');
        }
        const ctxRef = {
            current: {
                socket,
                request,
                connectionInitReceived: false,
                acknowledged: false,
                subscriptions: {},
            },
        };
        // kick the client off (close socket) if the connection has
        // not been initialised after the specified wait timeout
        const connectionInitWait = connectionInitWaitTimeout && // even 0 disables it
            connectionInitWaitTimeout !== Infinity &&
            setTimeout(() => {
                if (!ctxRef.current.connectionInitReceived) {
                    ctxRef.current.socket.close(4408, 'Connection initialisation timeout');
                }
            }, connectionInitWaitTimeout);
        // keep alive through ping-pong messages
        // read more about the websocket heartbeat here: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_servers#Pings_and_Pongs_The_Heartbeat_of_WebSockets
        let pongWait;
        const pingInterval = keepAlive && // even 0 disables it
            keepAlive !== Infinity &&
            setInterval(() => {
                // ping pong on open sockets only
                if (socket.readyState === WebSocket.OPEN) {
                    // terminate the connection after pong wait has passed because the client is idle
                    pongWait = setTimeout(() => {
                        socket.terminate();
                    }, keepAlive);
                    // listen for client's pong and stop socket termination
                    socket.once('pong', () => {
                        if (pongWait) {
                            clearTimeout(pongWait);
                            pongWait = null;
                        }
                    });
                    socket.ping();
                }
            }, keepAlive);
        function errorOrCloseHandler(errorOrClose) {
            if (connectionInitWait) {
                clearTimeout(connectionInitWait);
            }
            if (pongWait) {
                clearTimeout(pongWait);
            }
            if (pingInterval) {
                clearInterval(pingInterval);
            }
            if (isErrorEvent(errorOrClose)) {
                ctxRef.current.socket.close(1011, isProd ? 'Internal Error' : errorOrClose.message);
            }
            Object.entries(ctxRef.current.subscriptions).forEach(([, subscription]) => {
                var _a;
                (_a = subscription.return) === null || _a === void 0 ? void 0 : _a.call(subscription);
            });
        }
        socket.onerror = errorOrCloseHandler;
        socket.onclose = errorOrCloseHandler;
        socket.onmessage = makeOnMessage(ctxRef.current);
    }
    webSocketServer.on('connection', handleConnection);
    webSocketServer.on('error', (err) => {
        for (const client of webSocketServer.clients) {
            // report server errors by erroring out all clients with the same error
            client.emit('error', err);
        }
    });
    // Sends through a message only if the socket is open.
    async function sendMessage(ctx, message) {
        if (ctx.socket.readyState === WebSocket.OPEN) {
            return new Promise((resolve, reject) => {
                ctx.socket.send(message_1.stringifyMessage(message), (err) => err ? reject(err) : resolve());
            });
        }
    }
    function makeOnMessage(ctx) {
        return async function onMessage(event) {
            var e_1, _a;
            var _b, _c;
            try {
                const message = message_1.parseMessage(event.data);
                switch (message.type) {
                    case message_1.MessageType.ConnectionInit: {
                        if (ctx.connectionInitReceived) {
                            return ctx.socket.close(4429, 'Too many initialisation requests');
                        }
                        ctx.connectionInitReceived = true;
                        if (utils_1.isObject(message.payload)) {
                            ctx.connectionParams = message.payload;
                        }
                        if (onConnect) {
                            const permitted = await onConnect(ctx);
                            if (permitted === false) {
                                return ctx.socket.close(4403, 'Forbidden');
                            }
                        }
                        await sendMessage(ctx, {
                            type: message_1.MessageType.ConnectionAck,
                        });
                        ctx.acknowledged = true;
                        break;
                    }
                    case message_1.MessageType.Subscribe: {
                        if (!ctx.acknowledged) {
                            return ctx.socket.close(4401, 'Unauthorized');
                        }
                        const emit = {
                            next: async (result, args) => {
                                let nextMessage = {
                                    id: message.id,
                                    type: message_1.MessageType.Next,
                                    payload: result,
                                };
                                if (onNext) {
                                    const maybeResult = await onNext(ctx, nextMessage, args, result);
                                    if (maybeResult) {
                                        nextMessage = Object.assign(Object.assign({}, nextMessage), { payload: maybeResult });
                                    }
                                }
                                await sendMessage(ctx, nextMessage);
                            },
                            error: async (errors) => {
                                let errorMessage = {
                                    id: message.id,
                                    type: message_1.MessageType.Error,
                                    payload: errors,
                                };
                                if (onError) {
                                    const maybeErrors = await onError(ctx, errorMessage, errors);
                                    if (maybeErrors) {
                                        errorMessage = Object.assign(Object.assign({}, errorMessage), { payload: maybeErrors });
                                    }
                                }
                                await sendMessage(ctx, errorMessage);
                            },
                            complete: async () => {
                                const completeMessage = {
                                    id: message.id,
                                    type: message_1.MessageType.Complete,
                                };
                                await (onComplete === null || onComplete === void 0 ? void 0 : onComplete(ctx, completeMessage));
                                await sendMessage(ctx, completeMessage);
                            },
                        };
                        let execArgs;
                        const maybeExecArgsOrErrors = await (onSubscribe === null || onSubscribe === void 0 ? void 0 : onSubscribe(ctx, message));
                        if (maybeExecArgsOrErrors) {
                            if (utils_1.areGraphQLErrors(maybeExecArgsOrErrors)) {
                                return await emit.error(maybeExecArgsOrErrors);
                            }
                            execArgs = maybeExecArgsOrErrors; // because not graphql errors
                        }
                        else {
                            if (!schema) {
                                // you either provide a schema dynamically through
                                // `onSubscribe` or you set one up during the server setup
                                return webSocketServer.emit('error', new Error('The GraphQL schema is not provided'));
                            }
                            const { operationName, query, variables } = message.payload;
                            execArgs = {
                                contextValue: context,
                                schema,
                                operationName,
                                document: graphql_1.parse(query),
                                variableValues: variables,
                            };
                            const validationErrors = graphql_1.validate(execArgs.schema, execArgs.document);
                            if (validationErrors.length > 0) {
                                return await emit.error(validationErrors);
                            }
                        }
                        const operationAST = graphql_1.getOperationAST(execArgs.document, execArgs.operationName);
                        if (!operationAST) {
                            return await emit.error([
                                new graphql_1.GraphQLError('Unable to identify operation'),
                            ]);
                        }
                        // if onsubscribe didnt return anything, inject roots
                        if (!maybeExecArgsOrErrors) {
                            execArgs.rootValue = roots === null || roots === void 0 ? void 0 : roots[operationAST.operation];
                        }
                        // the execution arguments have been prepared
                        // perform the operation and act accordingly
                        let operationResult;
                        if (operationAST.operation === 'subscription') {
                            operationResult = await subscribe(execArgs);
                        }
                        else {
                            // operation === 'query' || 'mutation'
                            operationResult = await execute(execArgs);
                        }
                        if (onOperation) {
                            const maybeResult = await onOperation(ctx, message, execArgs, operationResult);
                            if (maybeResult) {
                                operationResult = maybeResult;
                            }
                        }
                        if (utils_1.isAsyncIterable(operationResult)) {
                            /** multiple emitted results */
                            // iterable subscriptions are distinct on ID
                            if (ctx.subscriptions[message.id]) {
                                return ctx.socket.close(4409, `Subscriber for ${message.id} already exists`);
                            }
                            ctx.subscriptions[message.id] = operationResult;
                            try {
                                for (var operationResult_1 = __asyncValues(operationResult), operationResult_1_1; operationResult_1_1 = await operationResult_1.next(), !operationResult_1_1.done;) {
                                    const result = operationResult_1_1.value;
                                    await emit.next(result, execArgs);
                                }
                            }
                            catch (e_1_1) { e_1 = { error: e_1_1 }; }
                            finally {
                                try {
                                    if (operationResult_1_1 && !operationResult_1_1.done && (_a = operationResult_1.return)) await _a.call(operationResult_1);
                                }
                                finally { if (e_1) throw e_1.error; }
                            }
                            await emit.complete();
                            delete ctx.subscriptions[message.id];
                        }
                        else {
                            /** single emitted result */
                            await emit.next(operationResult, execArgs);
                            await emit.complete();
                        }
                        break;
                    }
                    case message_1.MessageType.Complete: {
                        await ((_c = (_b = ctx.subscriptions[message.id]) === null || _b === void 0 ? void 0 : _b.return) === null || _c === void 0 ? void 0 : _c.call(_b));
                        break;
                    }
                    default:
                        throw new Error(`Unexpected message of type ${message.type} received`);
                }
            }
            catch (err) {
                // TODO-db-201031 we perceive this as a client bad request error, but is it always?
                ctx.socket.close(4400, err.message);
            }
        };
    }
    return {
        webSocketServer,
        dispose: async () => {
            for (const client of webSocketServer.clients) {
                client.close(1001, 'Going away');
            }
            webSocketServer.removeAllListeners();
            await new Promise((resolve, reject) => webSocketServer.close((err) => (err ? reject(err) : resolve())));
        },
    };
}
exports.createServer = createServer;
function isErrorEvent(obj) {
    return (utils_1.isObject(obj) &&
        utils_1.hasOwnObjectProperty(obj, 'error') &&
        utils_1.hasOwnStringProperty(obj, 'message') &&
        utils_1.hasOwnStringProperty(obj, 'type'));
}
function isWebSocketServer(obj) {
    return utils_1.isObject(obj) && typeof obj.on === 'function';
}
