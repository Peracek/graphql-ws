/**
 *
 * server
 *
 */
/// <reference types="node" />
import * as http from 'http';
import * as WebSocket from 'ws';
import { OperationTypeNode, GraphQLSchema, ExecutionArgs, GraphQLError, SubscriptionArgs, ExecutionResult } from 'graphql';
import { Disposable } from './types';
import { SubscribeMessage, NextMessage, ErrorMessage, CompleteMessage } from './message';
import { ID } from './types';
export declare type OperationResult = Promise<AsyncIterableIterator<ExecutionResult> | ExecutionResult> | AsyncIterableIterator<ExecutionResult> | ExecutionResult;
export interface ServerOptions {
    /**
     * The GraphQL schema on which the operations
     * will be executed and validated against.
     *
     * If the schema is left undefined, you're trusted to
     * provide one in the returned `ExecutionArgs` from the
     * `onSubscribe` callback.
     */
    schema?: GraphQLSchema;
    /**
     * A value which is provided to every resolver and holds
     * important contextual information like the currently
     * logged in user, or access to a database.
     *
     * If you return from the `onSubscribe` callback, this
     * context value will NOT be injected. You should add it
     * in the returned `ExecutionArgs` from the callback.
     */
    context?: unknown;
    /**
     * The GraphQL root fields or resolvers to go
     * alongside the schema. Learn more about them
     * here: https://graphql.org/learn/execution/#root-fields-resolvers.
     *
     * If you return from the `onSubscribe` callback, the
     * root field value will NOT be injected. You should add it
     * in the returned `ExecutionArgs` from the callback.
     */
    roots?: {
        [operation in OperationTypeNode]?: Record<string, NonNullable<SubscriptionArgs['rootValue']>>;
    };
    /**
     * Is the `execute` function from GraphQL which is
     * used to execute the query and mutation operations.
     *
     * Throwing an error from within this function will
     * close the socket with the `Error` message
     * in the close event reason.
     */
    execute: (args: ExecutionArgs) => OperationResult;
    /**
     * Is the `subscribe` function from GraphQL which is
     * used to execute the subscription operation.
     *
     * Throwing an error from within this function will
     * close the socket with the `Error` message
     * in the close event reason.
     */
    subscribe: (args: ExecutionArgs) => OperationResult;
    /**
     * The amount of time for which the server will wait
     * for `ConnectionInit` message.
     *
     * Set the value to `Infinity`, `''`, `0`, `null` or `undefined` to skip waiting.
     *
     * If the wait timeout has passed and the client
     * has not sent the `ConnectionInit` message,
     * the server will terminate the socket by
     * dispatching a close event `4408: Connection initialisation timeout`
     *
     * @default 3 * 1000 (3 seconds)
     */
    connectionInitWaitTimeout?: number;
    /**
     * The timout between dispatched keep-alive messages. Internally the lib
     * uses the [WebSocket Ping and Pongs]((https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_servers#Pings_and_Pongs_The_Heartbeat_of_WebSockets)) to check that the link between
     * the clients and the server is operating and to prevent the link from being broken due to idling.
     *
     * Set to nullish value to disable.
     *
     * @default 12 * 1000 (12 seconds)
     */
    keepAlive?: number;
    /**
     * Is the connection callback called when the
     * client requests the connection initialisation
     * through the message `ConnectionInit`.
     *
     * The message payload (`connectionParams` from the
     * client) is present in the `Context.connectionParams`.
     *
     * - Returning `true` or nothing from the callback will
     * allow the client to connect.
     *
     * - Returning `false` from the callback will
     * terminate the socket by dispatching the
     * close event `4403: Forbidden`.
     *
     * Throwing an error from within this function will
     * close the socket with the `Error` message
     * in the close event reason.
     */
    onConnect?: (ctx: Context) => Promise<boolean | void> | boolean | void;
    /**
     * The subscribe callback executed right after
     * acknowledging the request before any payload
     * processing has been performed.
     *
     * If you return `ExecutionArgs` from the callback,
     * it will be used instead of trying to build one
     * internally. In this case, you are responsible
     * for providing a ready set of arguments which will
     * be directly plugged in the operation execution.
     *
     * To report GraphQL errors simply return an array
     * of them from the callback, they will be reported
     * to the client through the error message.
     *
     * Useful for preparing the execution arguments
     * following a custom logic. A typical use case are
     * persisted queries, you can identify the query from
     * the subscribe message and create the GraphQL operation
     * execution args which are then returned by the function.
     *
     * Throwing an error from within this function will
     * close the socket with the `Error` message
     * in the close event reason.
     */
    onSubscribe?: (ctx: Context, message: SubscribeMessage) => Promise<ExecutionArgs | readonly GraphQLError[] | void> | ExecutionArgs | readonly GraphQLError[] | void;
    /**
     * Executed after the operation call resolves. For streaming
     * operations, triggering this callback does not necessarely
     * mean that there is already a result available - it means
     * that the subscription process for the stream has resolved
     * and that the client is now subscribed.
     *
     * The `OperationResult` argument is the result of operation
     * execution. It can be an iterator or already a value.
     *
     * If you want the single result and the events from a streaming
     * operation, use the `onNext` callback.
     *
     * Use this callback to listen for subscribe operation and
     * execution result manipulation.
     *
     * Throwing an error from within this function will
     * close the socket with the `Error` message
     * in the close event reason.
     */
    onOperation?: (ctx: Context, message: SubscribeMessage, args: ExecutionArgs, result: OperationResult) => Promise<OperationResult | void> | OperationResult | void;
    /**
     * Executed after an error occured right before it
     * has been dispatched to the client.
     *
     * Use this callback to format the outgoing GraphQL
     * errors before they reach the client.
     *
     * Returned result will be injected in the error message payload.
     *
     * Throwing an error from within this function will
     * close the socket with the `Error` message
     * in the close event reason.
     */
    onError?: (ctx: Context, message: ErrorMessage, errors: readonly GraphQLError[]) => Promise<readonly GraphQLError[] | void> | readonly GraphQLError[] | void;
    /**
     * Executed after an operation has emitted a result right before
     * that result has been sent to the client. Results from both
     * single value and streaming operations will appear in this callback.
     *
     * Use this callback if you want to format the execution result
     * before it reaches the client.
     *
     * Returned result will be injected in the next message payload.
     *
     * Throwing an error from within this function will
     * close the socket with the `Error` message
     * in the close event reason.
     */
    onNext?: (ctx: Context, message: NextMessage, args: ExecutionArgs, result: ExecutionResult) => Promise<ExecutionResult | void> | ExecutionResult | void;
    /**
     * The complete callback is executed after the
     * operation has completed right before sending
     * the complete message to the client.
     *
     * Throwing an error from within this function will
     * close the socket with the `Error` message
     * in the close event reason.
     */
    onComplete?: (ctx: Context, message: CompleteMessage) => Promise<void> | void;
}
export interface Context {
    /**
     * The actual WebSocket connection between the server and the client.
     */
    readonly socket: WebSocket;
    /**
     * The initial HTTP request before the actual
     * socket and connection is established.
     */
    readonly request: http.IncomingMessage;
    /**
     * Indicates that the `ConnectionInit` message
     * has been received by the server. If this is
     * `true`, the client wont be kicked off after
     * the wait timeout has passed.
     */
    connectionInitReceived: boolean;
    /**
     * Indicates that the connection was acknowledged
     * by having dispatched the `ConnectionAck` message
     * to the related client.
     */
    acknowledged: boolean;
    /** The parameters passed during the connection initialisation. */
    connectionParams?: Readonly<Record<string, unknown>>;
    /**
     * Holds the active subscriptions for this context.
     * Subscriptions are for **streaming operations only**,
     * those that resolve once wont be added here.
     */
    subscriptions: Record<ID, AsyncIterator<unknown>>;
}
export interface Server extends Disposable {
    webSocketServer: WebSocket.Server;
}
declare type WebSocketServerOptions = WebSocket.ServerOptions;
declare type WebSocketServer = WebSocket.Server;
/**
 * Creates a protocol complient WebSocket GraphQL
 * subscription server. Read more about the protocol
 * in the PROTOCOL.md documentation file.
 */
export declare function createServer(options: ServerOptions, websocketOptionsOrServer: WebSocketServerOptions | WebSocketServer): Server;
export {};
