import { Computation } from './сomputation';
import { RustExportOperationChannel  } from '../native/index';
import {
    IEventsInterfaces,
    EventsInterfaces,
    EventsSignatures,
    IEventsSignatures,
    IEvents,
    IOperationProgress,
} from '../interfaces/computation.minimal.withprogress';

import * as Events from '../util/events';

export { IExportOptions } from '../native/native.session.stream.export';


export class StreamExportComputation extends Computation<IEvents> {

    private readonly _events: IEvents = {
        progress: new Events.Subject<IOperationProgress>(),
        error: new Events.Subject<Error>(),
        destroyed: new Events.Subject<void>(),
    };

    constructor(channel: RustExportOperationChannel, uuid: string) {
        super(channel, uuid);
    }

    public getName(): string {
        return 'StreamExportComputation';
    }

    public getEvents(): IEvents {
        return this._events;
    }

    public getEventsSignatures(): IEventsSignatures {
        return EventsSignatures;
    }

    public getEventsInterfaces(): IEventsInterfaces {
        return EventsInterfaces;
    }


}
