/**
 *
 * client
 *
 */
import { Sink, ID, Disposable } from './types';
import { SubscribePayload } from './message';
export declare type EventConnecting = 'connecting';
export declare type EventConnected = 'connected';
export declare type EventClosed = 'closed';
export declare type Event = EventConnecting | EventConnected | EventClosed;
/**
 * The argument is actually the `WebSocket`, but to avoid bundling DOM typings
 * because the client can run in Node env too, you should assert
 * the websocket type during implementation.
 */
export declare type EventConnectedListener = (socket: unknown) => void;
export declare type EventConnectingListener = () => void;
/**
 * The argument is actually the websocket `CloseEvent`, but to avoid
 * bundling DOM typings because the client can run in Node env too,
 * you should assert the websocket type during implementation.
 */
export declare type EventClosedListener = (event: unknown) => void;
export declare type EventListener<E extends Event> = E extends EventConnecting ? EventConnectingListener : E extends EventConnected ? EventConnectedListener : E extends EventClosed ? EventClosedListener : never;
/** Configuration used for the `create` client function. */
export interface ClientOptions {
    /** URL of the GraphQL over WebSocket Protocol compliant server to connect. */
    url: string;
    /**
     * Optional parameters, passed through the `payload` field with the `ConnectionInit` message,
     * that the client specifies when establishing a connection with the server. You can use this
     * for securely passing arguments for authentication.
     */
    connectionParams?: Record<string, unknown> | (() => Record<string, unknown>);
    /**
     * Should the connection be established immediately and persisted
     * or after the first listener subscribed.
     *
     * @default true
     */
    lazy?: boolean;
    /**
     * How many times should the client try to reconnect on abnormal socket closure before it errors out?
     *
     * @default 5
     */
    retryAttempts?: number;
    /**
     * How long should the client wait until attempting to retry.
     *
     * @default 3 * 1000 (3 seconds)
     */
    retryTimeout?: number;
    /**
     * Register listeners before initialising the client. This way
     * you can ensure to catch all client relevant emitted events.
     *
     * The listeners passed in will **always** be the first ones
     * to get the emitted event before other registered listeners.
     */
    on?: Partial<{
        [event in Event]: EventListener<event>;
    }>;
    /**
     * A custom WebSocket implementation to use instead of the
     * one provided by the global scope. Mostly useful for when
     * using the client outside of the browser environment.
     */
    webSocketImpl?: unknown;
    /**
     * A custom ID generator for identifying subscriptions.
     *
     * The default generates a v4 UUID to be used as the ID using `Math`
     * as the random number generator. Supply your own generator
     * in case you need more uniqueness.
     *
     * Reference: https://stackoverflow.com/a/2117523/709884
     */
    generateID?: () => ID;
}
export interface Client extends Disposable {
    /**
     * Listens on the client which dispatches events about the socket state.
     */
    on<E extends Event>(event: E, listener: EventListener<E>): () => void;
    /**
     * Subscribes through the WebSocket following the config parameters. It
     * uses the `sink` to emit received data or errors. Returns a _cleanup_
     * function used for dropping the subscription and cleaning stuff up.
     */
    subscribe<T = unknown>(payload: SubscribePayload, sink: Sink<T>): () => void;
}
/** Creates a disposable GraphQL subscriptions client. */
export declare function createClient(options: ClientOptions): Client;
