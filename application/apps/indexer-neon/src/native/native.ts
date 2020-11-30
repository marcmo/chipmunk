import ServiceProduction from '../services/service.production';

export enum ERustEmitterEvents {
    error = 'error',
    destroyed = 'destroyed',
    ready = 'ready',
}

export interface IRustModuleExports {
    RustEmitterEvents: { [key: string]: ERustEmitterEvents };
    RustSession: any;
}

export function getNativeModule(): IRustModuleExports {
    if (ServiceProduction.isProd()) {
        const native = require("../../native/index.node");
        return native;
    } else {
        return {
            RustEmitterEvents: {},
            RustSession: {},
        };    
    }
}

const {
    RustEmitterEvents: RustEmitterEvents,
    RustSession: RustSessionChannelNoType,
} = getNativeModule();

const addon = getNativeModule();

export type TEventEmitter = (name: ERustEmitterEvents, data: any) => void;

export type RustChannelConstructorImpl<T> = new (emitter: TEventEmitter) => T;

export {
    RustEmitterEvents,
    RustSessionChannelNoType,
    addon
};