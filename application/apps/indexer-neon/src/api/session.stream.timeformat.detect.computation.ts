import { Computation } from './сomputation';
import { RustTimeFormatDetectOperationChannel } from '../native/index';

import * as Events from '../util/events';

export interface IDetectOptions {

}

export interface IDetectDTFormatResult {
    format: string;
    reg: string;
}

export interface IEvents {
    results: Events.Subject<IDetectDTFormatResult>,
    error: Events.Subject<Error>,
    destroyed: Events.Subject<void>,
}

interface IEventsSignatures {
    results: 'results';
    error: 'error';
    destroyed: 'destroyed';
};

const EventsInterface = {
    results: { self: 'object', format: 'string', reg: 'string' },
    error: { self: Error },
    destroyed: { self: null },
};

export class StreamTimeFormatDetectComputation extends Computation<IEvents> {

    private readonly _events: IEvents = {
        results: new Events.Subject<any>(),
        error: new Events.Subject<Error>(),
        destroyed: new Events.Subject<void>(),
    };

    constructor(channel: RustTimeFormatDetectOperationChannel, uuid: string) {
        super(channel, uuid);
    }

    public getName(): string {
        return 'StreamTimeFormatDetectComputation';
    }

    public getEvents(): IEvents {
        return this._events;
    }

    public getEventsSignatures(): IEventsSignatures {
        return {
            results: 'results',
            error: 'error',
            destroyed: 'destroyed',
        };
    }

    public getEventsInterfaces() {
        return EventsInterface;
    }


}
