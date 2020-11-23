import * as Events from '../util/events';

export interface IOperationProgress {
    /**
     * @field percentage { number } value of progress from 0 to 100
     */
    percentage: number;
    /**
     * optional @field desc { string }
     * Addition description of current stage to show in UI.
     */
    desc?: string;
    /**
     * optional @field meta { string }
     * Addition meta of current stage. For example it can be description of file type
     * for append / open file operation.
     */
    meta?: any;
}

export interface IEvents {
    /**
     * @event progress { IOperationProgress }
     * Optionally operation executor can emit @event progress to reflect currect progress of 
     * operation
     */
    progress: Events.Subject<IOperationProgress>,
    /**
     * @event error { Error }
     * Calls on any error on rust side. Emitting of @event error doesn't mean 
     * stopping of operation.
     */
    error: Events.Subject<Error>,
    /**
     * @event destroyed { void }
     * Calls always as soon as instance of computation is destroyed. No any
     * events should be called after "destroyed" event was emited
     */
    destroyed: Events.Subject<void>,
}

export interface IEventsSignatures {
    progress: 'progress';
    error: 'error';
    destroyed: 'destroyed';
}

export const EventsSignatures: IEventsSignatures = {
    progress: 'progress',
    error: 'error',
    destroyed: 'destroyed',
}

export interface IEventsInterfaces {
    progress: { self: 'object', percentage: 'number' };
    error: { self: typeof Error };
    destroyed: { self: null };
}

export const EventsInterfaces: IEventsInterfaces = {
    progress: { self: 'object', percentage: 'number' },
    error: { self: Error },
    destroyed: { self: null },
}