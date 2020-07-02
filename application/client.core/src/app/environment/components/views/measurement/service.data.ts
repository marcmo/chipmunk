import { Subscription, Subject, Observable } from 'rxjs';
import { IRange, EChartMode } from '../../../controller/controller.session.tab.timestamp';
import { ControllerSessionTab } from '../../../controller/controller.session.tab';

import TabsSessionsService from '../../../services/service.sessions.tabs';
import EventsSessionService from '../../../services/standalone/service.events.session';

import * as Toolkit from 'chipmunk.client.toolkit';

export { EChartMode };

export interface IZoomEvent {
    x: number;
    width: number;
    change: number;
}

export class DataService {

    public readonly SCALED_ROW_HEIGHT: number = 50;
    public readonly MAX_BAR_HEIGHT: number = 16;
    public readonly MIN_BAR_HEIGHT: number = 2;

    private _refs: number[] = [];
    private _ranges: IRange[] = [];
    private _subscriptions: { [key: string]: Subscription } = {};
    private _sessionSubscriptions: { [key: string]: Subscription } = {};
    private _logger: Toolkit.Logger = new Toolkit.Logger('MeasurementDataService');
    private _session: ControllerSessionTab | undefined;
    private _mode: EChartMode = EChartMode.aligned;
    private _subjects: {
        update: Subject<void>,  // Updates happens in scope of session
        change: Subject<void>, // Session was changed
        zoom: Subject<void>,
        mode: Subject<void>,
    } = {
        update: new Subject(),
        change: new Subject(),
        zoom: new Subject(),
        mode: new Subject(),
    };

    constructor() {
        this._subscriptions.onSessionChange = EventsSessionService.getObservable().onSessionChange.subscribe(
            this._onSessionChange.bind(this),
        );
        this._onSessionChange(TabsSessionsService.getActive());
    }

    destroy() {
        Object.keys(this._subscriptions).forEach((key: string) => {
            this._subscriptions[key].unsubscribe();
        });
        Object.keys(this._sessionSubscriptions).forEach((key: string) => {
            this._sessionSubscriptions[key].unsubscribe();
        });
    }

    public getObservable(): {
        update: Observable<void>,
        change: Observable<void>,
        zoom: Observable<void>,
        mode: Observable<void>,
    } {
        return {
            update: this._subjects.update.asObservable(),
            change: this._subjects.change.asObservable(),
            zoom: this._subjects.zoom.asObservable(),
            mode: this._subjects.mode.asObservable(),
        };
    }

    public getMode(): EChartMode {
        return this._mode;
    }

    public toggleMode() {
        if (this._session === undefined) {
            return;
        }
        this._session.getTimestamp().setMode(this._mode === EChartMode.aligned ? EChartMode.scaled : EChartMode.aligned);
    }

    public getChartDataset(overview: boolean = false): {
        datasets: any[],
        labels: string[],
        maxY?: number
    } {
        if (overview) {
            return this._getChartDatasetModeScale(true);
        } else {
            switch (this._mode) {
                case EChartMode.aligned:
                    return this._getChartDatasetModeAlign();
                case EChartMode.scaled:
                    return this._getChartDatasetModeScale();
            }
        }
    }

    public getRefs(): number[] {
        return this._refs;
    }

    public getMinTimestamp(): number {
        return this._session === undefined ? 0 : this._session.getTimestamp().getMinTimestamp();
    }

    public getMaxTimestamp(): number {
        return this._session === undefined ? 0 : this._session.getTimestamp().getMaxTimestamp();
    }

    public getMaxDuration(): number {
        return this._session === undefined ? 0 : this._getMaxDurationPerGroups();
    }

    public getMinXAxe(): number {
        const cursor = this.getCursorState();
        if (cursor === undefined) {
            return undefined;
        }
        const min = this.getMinTimestamp();
        return min + cursor.left;
    }

    public getMaxXAxe(): number {
        const cursor = this.getCursorState();
        if (cursor === undefined) {
            return undefined;
        }
        const max = this.getMaxTimestamp();
        return max - cursor.right;
    }

    public getRangesCount(): number {
        return this._getComplitedRanges().length;
    }

    public zoom(event: IZoomEvent) {
        const cursor = this.getCursorState();
        if (cursor === undefined) {
            return;
        }
        const point: number = event.x / event.width;
        const minT = this.getMinTimestamp();
        const maxT = this.getMaxTimestamp();
        const min = minT + cursor.left;
        const max = maxT - cursor.right;
        const step = Math.abs(max - min) / event.width;
        let left = Math.abs(cursor.left + event.change * point * step);
        let right = Math.abs(cursor.right + event.change * (1 - point) * step);
        if (minT + left < minT) {
            left = 0;
        }
        if (maxT - right > maxT) {
            right = 0;
        }
        this._session.getTimestamp().setZoomOffsets(left, right);
    }

    public setZoomOffsets(left: number, right: number) {
        if (this._session === undefined) {
            return;
        }
        this._session.getTimestamp().setZoomOffsets(left, right);
    }

    public getCursorState(): undefined | {
        left: number,
        right: number,
        duration: number,
        min: number,
        max: number,
    } {
        if (this._session === undefined) {
            return undefined;
        }
        return this._session.getTimestamp().getCursorState();
    }

    private _getChartDatasetModeAlign(): {
        datasets: any[],
        labels: string[],
        maxY?: number
    } {
        const labels: string[] = [];
        const datasets: any[] = [];
        const groups: Map<number, IRange[]> = this._getGroups();
        let y: number = 1;
        groups.forEach((ranges: IRange[], groupId: number) => {
            ranges.sort((a: IRange, b: IRange) => {
                return a.end.timestamp > b.end.timestamp ? 1 : -1;
            });
            let offset: number = 0;
            ranges.forEach((range: IRange, index: number) => {
                const normalized = this._getNormalizedRange(range);
                // y += 1;
                const values: Array<{ x: number, y: number, duration?: number, range?: boolean, row?: number }> = [{
                    x: offset,
                    y: y,
                },
                {
                    x: offset + normalized.duration,
                    y: y,
                    duration: normalized.duration,
                    row: range.start.position < range.end.position ? range.start.position : range.end.position,
                    range: true,
                }];
                datasets.push({
                    data: values,
                    borderColor: range.color,
                    borderWidth: this.MAX_BAR_HEIGHT,
                    pointBackgroundColor: [range.color, range.color],
                    pointBorderColor: [range.color, range.color],
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    fill: false,
                    tension: 0,
                    showLine: true,
                    range: range,
                });
                offset += normalized.duration;
            });
            y += 1;
        });
        return {
            datasets: datasets,
            labels: labels,
            maxY: y,
        };
    }

    private _getChartDatasetModeScale(overview: boolean = false): {
        datasets: any[],
        labels: string[],
        maxY?: number
    } {
        const labels: string[] = [];
        const datasets: any[] = [];
        const groups: Map<number, IRange[]> = this._getGroups();
        let y: number = 1;
        let prev: { min: number, max: number } | undefined;
        groups.forEach((ranges: IRange[], groupId: number) => {
            const borders = this._getGroupBorders(groupId);
            ranges.sort((a: IRange, b: IRange) => {
                return a.end.timestamp > b.end.timestamp ? 1 : -1;
            });
            if (!overview && prev !== undefined && ranges.length > 0) {
                const range = ranges[ranges.length - 1];
                const next: { min: number, max: number } = {
                    min: range.start.timestamp < range.end.timestamp ? range.start.timestamp : range.end.timestamp,
                    max: range.start.timestamp > range.end.timestamp ? range.start.timestamp : range.end.timestamp
                };
                const min: number = prev.max < next.min ? prev.max : next.max;
                const max: number = prev.max < next.min ? next.min : prev.min;
                const values: Array<{ x: number, y: number, duration?: number }> = [{
                    x: min < max ? min : max,
                    y: y - 0.5,
                },
                {
                    x: min > max ? min : max,
                    y: y - 0.5,
                    duration: Math.abs(max - min),
                }];
                datasets.push({
                    data: values,
                    borderColor: '#999999',
                    borderWidth: 1,
                    pointBackgroundColor: ['#999999', '#999999'],
                    pointBorderColor: ['#999999', '#999999'],
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    fill: false,
                    tension: 0,
                    showLine: true
                });
            }
            let offset: number = borders.min;
            ranges.forEach((range: IRange, index: number) => {
                const normalized = this._getNormalizedRange(range);
                // y += 1;
                const values: Array<{ x: number, y: number, duration?: number, range?: boolean, row?: number }> = [{
                    x: offset,
                    y: y,
                },
                {
                    x: offset + normalized.duration,
                    y: y,
                    duration: normalized.duration,
                    row: range.start.position < range.end.position ? range.start.position : range.end.position,
                    range: true,
                }];
                datasets.push({
                    data: values,
                    borderColor: range.color,
                    borderWidth: overview ? this.MIN_BAR_HEIGHT : this.MAX_BAR_HEIGHT,
                    pointBackgroundColor: [range.color, range.color],
                    pointBorderColor: [range.color, range.color],
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    fill: false,
                    tension: 0,
                    showLine: true,
                    range: range,
                });
                if (!overview) {
                    if (prev === undefined) {
                        prev = normalized;
                    } else {
                        if (prev.min > offset) {
                            prev.max = offset;
                        }
                        if (prev.max < offset + normalized.duration) {
                            prev.max = offset + normalized.duration;
                        }
                    }
                }
                offset += normalized.duration;
            });
            y += 1;
        });
        return {
            datasets: datasets,
            labels: labels,
            maxY: y,
        };
    }

    private _getGroups(): Map<number, IRange[]> {
        const groups: Map<number, IRange[]> = new Map();
        this._getComplitedRanges().forEach((range: IRange) => {
            const ranges: IRange[] = groups.has(range.group) ? groups.get(range.group) : [];
            ranges.push(range);
            groups.set(range.group, ranges);
        });
        return groups;
    }

    private _getGroupBorders(group: number): { min: number, max: number, duration: number } {
        let min: number = Infinity;
        let max: number = -1;
        this._getComplitedRanges().forEach((range: IRange) => {
            if (range.group !== group) {
                return;
            }
            if (range.end.timestamp < min) {
                min = range.end.timestamp;
            }
            if (range.start.timestamp < min) {
                min = range.start.timestamp;
            }
            if (range.end.timestamp > max) {
                max = range.end.timestamp;
            }
            if (range.start.timestamp > max) {
                max = range.start.timestamp;
            }
        });
        return { min: min, max: max, duration: Math.abs(max - min) };
    }

    private _getMaxDurationPerGroups(): number {
        const groups = this._getGroups();
        let duration = -1;
        groups.forEach((_, groupId: number) => {
            const borders = this._getGroupBorders(groupId);
            if (duration < borders.duration) {
                duration = borders.duration;
            }
        });
        return duration;
    }

    private _getComplitedRanges(): IRange[] {
        return this._ranges.filter((range: IRange) => {
            return range.end !== undefined;
        });
    }

    private _getNormalizedRange(range: IRange): { min: number, max: number, duration: number  } {
        const result = {
            min: range.start.timestamp < range.end.timestamp ? range.start.timestamp : range.end.timestamp,
            max: range.start.timestamp > range.end.timestamp ? range.start.timestamp : range.end.timestamp,
            duration: 0,
        };
        result.duration = Math.abs(result.max - result.min);
        return result;
    }

    private _refresh(ranges?: IRange[], change: boolean = false) {
        this._ranges = ranges instanceof Array ? ranges : (this._session === undefined ? [] : this._session.getTimestamp().getRanges());
        if (!change) {
            this._subjects.update.next();
        } else {
            this._subjects.change.next();
        }
    }

    private _onSessionChange(controller?: ControllerSessionTab) {
        Object.keys(this._sessionSubscriptions).forEach((key: string) => {
            this._sessionSubscriptions[key].unsubscribe();
        });
        if (controller !== undefined) {
            this._sessionSubscriptions.change = controller.getTimestamp().getObservable().change.subscribe(this._onRangeChange.bind(this));
            this._sessionSubscriptions.update = controller.getTimestamp().getObservable().update.subscribe(this._onRangesUpdate.bind(this));
            this._sessionSubscriptions.mode = controller.getTimestamp().getObservable().mode.subscribe(this._onModeChange.bind(this));
            this._sessionSubscriptions.zoom = controller.getTimestamp().getObservable().zoom.subscribe(this._onZoom.bind(this));
            this._mode = controller.getTimestamp().getMode();
            this._session = controller;
        } else {
            this._session = undefined;
        }
        this._refresh(undefined, true);
    }

    private _onRangeChange(range: IRange) {
        this._refresh();
    }

    private _onRangesUpdate(ranges: IRange[]) {
        this._refresh(ranges);
    }

    private _onModeChange(mode: EChartMode) {
        this._mode = mode;
        this._refresh(undefined, true);
        this._subjects.mode.next();
    }

    private _onZoom() {
        this._subjects.zoom.next();
    }

}
