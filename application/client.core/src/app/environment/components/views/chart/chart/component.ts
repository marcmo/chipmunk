import { Component, Input, AfterViewInit, OnDestroy, ChangeDetectorRef, ViewContainerRef, AfterContentInit, HostListener } from '@angular/core';
import { Subscription } from 'rxjs';
import { Chart } from 'chart.js';
import { ServiceData, IRange, IResults, IChartsResults, EScaleType, IScaleState } from '../service.data';
import { ServicePosition, IPositionChange } from '../service.position';
import { IMenuItem } from '../../../../services/standalone/service.contextmenu';
import { ControllerSessionTab } from '../../../../controller/controller.session.tab';
import { ChartRequest } from '../../../../controller/controller.session.tab.search.charts.request';

import OutputRedirectionsService from '../../../../services/standalone/service.output.redirections';
import ViewsEventsService from '../../../../services/standalone/service.views.events';
import ContextMenuService from '../../../../services/standalone/service.contextmenu';
import TabsSessionsService from '../../../../services/service.sessions.tabs';
import EventsSessionService from '../../../../services/standalone/service.events.session';

import * as Toolkit from 'chipmunk.client.toolkit';

const CSettings = {
    rebuildDelay: 250,
    redrawDelay: 50,
    maxPostponedRedraws: 50,
};

@Component({
    selector: 'app-views-chart-canvas',
    templateUrl: './template.html',
    styleUrls: ['./styles.less']
})

export class ViewChartCanvasComponent implements AfterViewInit, AfterContentInit, OnDestroy {

    @Input() service: ServiceData;
    @Input() position: ServicePosition;

    public _ng_width: number = 100;
    public _ng_height: number = 100;
    public _ng_filters: Chart | undefined;
    public _ng_charts: Chart | undefined;

    private _subscriptions: { [key: string]: Subscription } = {};
    private _subscriptionsSession: { [key: string]: Subscription } = {};
    private _logger: Toolkit.Logger = new Toolkit.Logger('ViewChartCanvasComponent');
    private _destroyed: boolean = false;
    private _mainViewPosition: number | undefined;
    private _redirectMainView: boolean = false;
    private _rebuild: {
        timer: any,
        last: number,
    } = {
        timer: -1,
        last: 0,
    };
    private _redraw: {
        timer: any,
        postponed: number,
    } = {
        timer: -1,
        postponed: 0,
    };
    private _position: IPositionChange = {
        left: -1,
        width: -1,
        full: -1,
    };

    constructor(private _cdRef: ChangeDetectorRef,
                private _vcRef: ViewContainerRef) {

    }

    @HostListener('wheel', ['$event']) _ng_onWheel(event: WheelEvent) {
        const chart: Chart | undefined = this._ng_filters || this._ng_charts;
        if (chart === undefined) {
            return;
        }
        const width: number = chart.chartArea.right - chart.chartArea.left;
        const offset: number = event.offsetX - chart.chartArea.left;
        this.position.force({
            deltaY: event.deltaY,
            proportionX: offset / width,
        });
    }

    ngAfterContentInit() {
        const position: IPositionChange | undefined = this.position.get();
        if (position === undefined) {
            return;
        }
        this._position = Object.assign({}, position);
    }

    ngAfterViewInit() {
        // Data events
        this._subscriptions.onData = this.service.getObservable().onData.subscribe(this._onData.bind(this));
        this._subscriptions.onCharts = this.service.getObservable().onCharts.subscribe(this._onChartData.bind(this));
        this._subscriptions.onChartsScaleType = this.service.getObservable().onChartsScaleType.subscribe(this._onChartsScaleType.bind(this));
        // Position events
        this._subscriptions.onPosition = this.position.getObservable().onChange.subscribe(this._onPosition.bind(this));
        // Listen session changes event
        this._subscriptions.onViewResize = ViewsEventsService.getObservable().onResize.subscribe(this._onViewResize.bind(this));
        // Listen session events
        this._subscriptions.onSessionChange = EventsSessionService.getObservable().onSessionChange.subscribe(this._onSessionChange.bind(this));
        // Update size of canvas and containers
        this._resize();
        // Subscribe session events
        this._subscribeSessionEvents(undefined);
        // Try to build chart
        this._build();
    }

    ngOnDestroy() {
        this._destroyed = true;
        this._unsubscribeSessionEvents();
        Object.keys(this._subscriptions).forEach((key: string) => {
            this._subscriptions[key].unsubscribe();
        });
        if (this._ng_charts !== undefined) {
            this._ng_charts.destroy();
            this._ng_charts = undefined;
        }
        if (this._ng_filters !== undefined) {
            this._ng_filters.destroy();
            this._ng_filters = undefined;
        }
    }

    public _ng_onClick(event: MouseEvent) {
        if (event.target === undefined) {
            return;
        }
        let position: number | undefined = this._getPositionByChartPointData(event);
        // Try to get data
        if (position === undefined) {
            const rows: number = this.service.getStreamSize();
            const size: ClientRect = (event.target as HTMLElement).getBoundingClientRect();
            const rate: number = size.width / rows;
            position = Math.round(event.offsetX / rate);
        }
        OutputRedirectionsService.select('chart', this.service.getSessionGuid(), position);
    }

    public _ng_onContexMenu(event: MouseEvent) {
        const items: IMenuItem[] = [
            {
                caption: this._redirectMainView ? 'Scroll main view: prevent' : 'Scroll main view: allow',
                handler: () => {
                    this._redirectMainView = !this._redirectMainView;
                },
            },
        ];
        ContextMenuService.show({
            items: items,
            x: event.pageX,
            y: event.pageY,
        });
        event.stopImmediatePropagation();
        event.preventDefault();
    }

    private _resize(force: boolean = false) {
        if (this._destroyed) {
            return;
        }
        const size: ClientRect = (this._vcRef.element.nativeElement as HTMLElement).getBoundingClientRect();
        if (this._ng_width === size.width && this._ng_height === size.height) {
            return;
        }
        this._ng_width = size.width;
        this._ng_height = size.height;
        this._forceUpdate();
        clearTimeout(this._redraw.timer);
        if (!force && this._redraw.postponed < CSettings.maxPostponedRedraws) {
            this._redraw.postponed += 1;
            this._redraw.timer = setTimeout(this._resize.bind(this, true), CSettings.redrawDelay);
            return;
        }
        this._redraw.postponed = 0;
        this._redraw.timer = -1;
        if (this._ng_filters !== undefined) {
            this._ng_filters.resize();
        }
        if (this._ng_charts !== undefined) {
            this._ng_charts.resize();
        }
    }

    private _build(force: boolean = false) {
        clearTimeout(this._rebuild.timer);
        const delay: number = Date.now() - this._rebuild.last;
        if (!force && delay < CSettings.rebuildDelay) {
            this._rebuild.timer = setTimeout(this._build.bind(this), delay > CSettings.rebuildDelay ? CSettings.rebuildDelay : delay);
            return;
        }
        this._rebuild.last = Date.now();
        this._rebuild.timer = -1;
        this._matches();
        this._charts();
    }

    private _matches() {
        if (this.service === undefined) {
            return;
        }
        let width: number = 0;
        if (this._ng_width < this.service.getStreamSize()) {
            width = Math.round(this._ng_width / 4);
        } else {
            width = this._ng_width;
        }
        const labels: string[] = this.service.getLabes(width, this._getRange());
        const datasets: IResults = this.service.getDatasets(width, this._getRange());
        if (labels.length === 0 || datasets.dataset.length === 0) {
            if (this._ng_filters !== undefined) {
                this._ng_filters.destroy();
            }
            this._ng_filters = undefined;
            return this._forceUpdate();
        }
        if (this._ng_filters !== undefined && (this._ng_filters.data.datasets === undefined || this._ng_filters.data.datasets.length === 0)) {
            this._ng_filters.destroy();
            this._ng_filters = undefined;
        }
        if (this._ng_filters === undefined) {
            this._ng_filters = new Chart('view-chart-canvas-filters', {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: datasets.dataset,
                },
                options: {
                    title: {
                        display: false,
                    },
                    legend: {
                        display: false,
                    },
                    animation: {
                        duration: 0
                    },
                    hover: {
                        animationDuration: 0
                    },
                    responsiveAnimationDuration: 0,
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        yAxes: [{
                            display: false, // TODO: make axes visible
                            stacked: true,
                            ticks: {
                                beginAtZero: true,
                                max: Math.round(datasets.max + datasets.max * 0.1)
                            },
                        }],
                        xAxes: [{
                            stacked: true,
                            display: false,
                        }]
                    }
                }
            });
            this._forceUpdate();
        } else {
            this._ng_filters.data.labels = labels;
            this._ng_filters.data.datasets = datasets.dataset;
            this._ng_filters.options.scales.yAxes[0].ticks.max = Math.round(datasets.max + datasets.max * 0.1);
            setTimeout(() => {
                if (this._destroyed) {
                    return;
                }
                if (this._ng_filters === undefined) {
                    return;
                }
                this._ng_filters.update();
            });
        }
        this._scrollMainView();
    }

    private _charts() {
        if (this.service === undefined) {
            return;
        }
        const datasets: IChartsResults = this.service.getChartsDatasets(this._ng_width, this._getRange());
        let range: IRange | undefined = this._getRange();
        if (range === undefined) {
            range = {
                begin: 0,
                end: this.service.getStreamSize()
            };
        }
        if (this._ng_charts !== undefined && (this._ng_charts.data.datasets === undefined || this._ng_charts.data.datasets.length === 0)) {
            this._ng_charts.destroy();
            this._ng_charts = undefined;
        }
        if (this._ng_charts === undefined) {
            this._ng_charts = new Chart('view-chart-canvas-charts', {
                type: 'scatter',
                data: {
                    datasets: datasets.dataset,
                },
                options: {
                    title: {
                        display: false,
                    },
                    legend: {
                        display: false,
                    },
                    animation: {
                        duration: 0
                    },
                    hover: {
                        animationDuration: 0
                    },
                    responsiveAnimationDuration: 0,
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        xAxes: [{
                            ticks: {
                                min: range.begin,
                                max: range.end,
                            },
                            gridLines: {
                                color: '#888',
                                drawOnChartArea: false
                            },
                           display: false
                        }],
                        yAxes: this._getYAxes(datasets.scale),
                    }
                }
            });
            this._forceUpdate();
        } else {
            this._ng_charts.data.datasets = datasets.dataset;
            this._ng_charts.options.scales.xAxes[0].ticks.max = range.end;
            this._ng_charts.options.scales.xAxes[0].ticks.min = range.begin;
            this._ng_charts.options.scales.yAxes = this._getYAxes(datasets.scale);
            this._softChartUpdate();
        }
        this._scrollMainView();
    }

    private _getYAxes(scale: IScaleState) {
        if (scale.yAxisIDs.length === 0) {
            return [{
                display: false,
            }];
        }
        return scale.yAxisIDs.map((yAxisID, i: number) => {
            let min: number = 0;
            let max: number = 100;
            switch (this.service.getScaleType()) {
                case EScaleType.common:
                    min = scale.min[i];
                    max = scale.max[i];
                    break;
                case EScaleType.common:
                    min = Math.min(...scale.min);
                    max = Math.max(...scale.max);
                    break;
            }
            const display: boolean = this._getSelectedChartYAxisId() === yAxisID;
            return {
                display: display,
                type: 'linear',
                id: yAxisID,
                position: 'left',
                ticks: {
                    min: min === undefined ? undefined : Math.floor(min - min * 0.02),
                    max: max === undefined ? undefined : Math.ceil(max + max * 0.02),
                    fontColor: display ? scale.colors[i] : undefined,
                    fontSize: 11,
                },
            };
        });
    }

    private _getRange(): IRange | undefined {
        const size: number | undefined = this.service.getStreamSize();
        if (size === undefined) {
            return undefined;
        }
        if (this._position.left === undefined || this._position.width === undefined || this._position.full === undefined) {
            return undefined;
        }
        if (this._position.left < 0 || this._position.width <= 0 || this._position.full <= 0) {
            return undefined;
        }
        if (isNaN(this._position.left) || isNaN(this._position.width) || isNaN(this._position.full) ||
            !isFinite(this._position.left) || !isFinite(this._position.width) || !isFinite(this._position.full) ) {
            this._logger.warn(`Get unexpected values of possition.`);
            return undefined;
        }
        const rate: number = this._position.full / size;
        let range: IRange;
        if (rate > 1) {
            range = {
                begin: 0,
                end: size - 1
            };
        } else {
            const left: number = Math.floor(this._position.left / rate);
            const width: number = Math.floor(this._position.width / rate);
            range = {
                begin: left,
                end: left + width
            };
            range.end = range.end >= size ? size - 1 : range.end;
        }
        return range;
    }

    private _softChartUpdate() {
        setTimeout(() => {
            if (this._destroyed) {
                return;
            }
            if (this._ng_charts === undefined) {
                return;
            }
            this._ng_charts.update();
        });
    }

    private _scrollMainView() {
        if (this._mainViewPosition === undefined) {
            return;
        }
        const range: IRange | undefined = this._getRange();
        if (range === undefined) {
            return;
        }
        if (this._mainViewPosition === range.begin) {
            return;
        }
        if (this._redirectMainView) {
            OutputRedirectionsService.select('chart', this.service.getSessionGuid(), range.begin);
        }
        this._mainViewPosition = range.begin;
    }

    private _onData() {
        this._matches();
    }

    private _onChartData() {
        this._charts();
    }

    private _onChartsScaleType(scale: EScaleType) {
        if (this._ng_charts === undefined) {
            return;
        }
        this._ng_charts.options.scales.yAxes = this._getYAxes(this.service.getScaleState());
        this._softChartUpdate();
    }

    private _onPosition(position: IPositionChange) {
        this._position = position;
        this._build();
        // Remember first attempt to change position / scale of chart
        if (this._mainViewPosition !== undefined) {
            return;
        }
        this._mainViewPosition = -1;
    }

    private _onViewResize() {
        this._resize();
    }

    private _onSessionChange(session: ControllerSessionTab | undefined) {
        if (session === undefined) {
            return;
        }
        if (this._ng_filters !== undefined) {
            this._ng_filters.destroy();
            this._ng_filters = undefined;
        }
        if (this._ng_charts !== undefined) {
            this._ng_charts.destroy();
            this._ng_charts = undefined;
        }
        this._subscribeSessionEvents(session);
        this._build();
    }

    private _subscribeSessionEvents(session: ControllerSessionTab | undefined) {
        this._unsubscribeSessionEvents();
        session = session === undefined ? TabsSessionsService.getActive() : session;
        if (session === undefined) {
            return;
        }
        this._subscriptionsSession.onChartSelected = session.getSessionSearch().getChartsAPI().getObservable().onChartSelected.subscribe(this._onChartSelected.bind(this));
    }

    private _getSelectedChartYAxisId(): string | undefined {
        const session = TabsSessionsService.getActive();
        if (session === undefined) {
            return;
        }
        const selected: ChartRequest | undefined = session.getSessionSearch().getChartsAPI().getSelectedChart();
        if (selected === undefined) {
            return;
        }
        return `Y-${selected.asRegExp().source}`;
    }

    private _onChartSelected() {
        if (this._ng_charts === undefined) {
            return;
        }
        this._ng_charts.options.scales.yAxes = this._getYAxes(this.service.getScaleState());
        this._softChartUpdate();
    }

    private _unsubscribeSessionEvents() {
        Object.keys(this._subscriptionsSession).forEach((key: string) => {
            this._subscriptionsSession[key].unsubscribe();
        });
    }

    private _getPositionByChartPointData(event: MouseEvent): number | undefined {
        let position: number | undefined;
        [this._ng_charts, this._ng_filters].forEach((chart: Chart | undefined) => {
            if (position !== undefined) {
                return;
            }
            if (chart === undefined) {
                return;
            }
            // This feature of chartjs isn't documented well,
            // so that's why here we have many checks
            const e: any[] = chart.getElementAtEvent(event);
            if (!(e instanceof Array)) {
                return;
            }
            if (e.length === 0) {
                return;
            }
            let label: any = this._getValueByPath(e[0], '_model.label');
            if (label !== undefined) {
                position = parseInt(label.replace(/\s-\s\d*/gi, ''), 10);
            } else {
                label = this._getValueByPath(e[0], '_chart.tooltip._model.body');
                if (label instanceof Array && label.length > 0 && label[0].lines instanceof Array && label[0].lines.length > 0) {
                    label = typeof label[0].lines[0] === 'string' ? label[0].lines[0] : undefined;
                    if (label !== undefined) {
                        position = parseInt(label.replace(/[\(\)]/gi, '').replace(/,\s\d*/gi, ''), 10) - 1;
                    }
                }
            }
            if (isNaN(position) || !isFinite(position)) {
                position = undefined;
            }
        });
        return position;
    }

    private _getValueByPath(obj: any, path: string): any {
        if (typeof obj !== 'object' || obj === null) {
            return undefined;
        }
        const parts: string[] = path.split('.');
        if (parts.length === 1) {
            return obj[parts[0]];
        }
        return this._getValueByPath(obj[parts[0]], parts.slice(1, parts.length).join('.'));
    }

    private _forceUpdate() {
        if (this._destroyed) {
            return;
        }
        this._cdRef.detectChanges();
    }

}
