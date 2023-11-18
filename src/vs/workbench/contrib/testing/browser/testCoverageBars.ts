/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { h } from 'vs/base/browser/dom';
import { assertNever } from 'vs/base/common/assert';
import { Emitter } from 'vs/base/common/event';
import { IMarkdownString, MarkdownString } from 'vs/base/common/htmlContent';
import { Lazy } from 'vs/base/common/lazy';
import { Disposable, DisposableStore, toDisposable } from 'vs/base/common/lifecycle';
import { isDefined } from 'vs/base/common/types';
import { localize } from 'vs/nls';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { chartsGreen, chartsRed, chartsYellow } from 'vs/platform/theme/common/colorRegistry';
import { TestingConfigKeys, TestingDisplayedCoveragePercent, getTestingConfiguration } from 'vs/workbench/contrib/testing/common/configuration';
import { AbstractFileCoverage } from 'vs/workbench/contrib/testing/common/testCoverage';
import { ICoveredCount } from 'vs/workbench/contrib/testing/common/testTypes';
import { IHoverService } from 'vs/workbench/services/hover/browser/hover';

export interface TestCoverageBarsOptions {
	compact: boolean;
	container: HTMLElement;
}

const colorThresholds = [
	{ color: chartsGreen, threshold: 0.9 },
	{ color: chartsYellow, threshold: 0.8 },
	{ color: chartsRed, threshold: -Infinity },
];

export abstract class AbstractTestCoverageBars extends Disposable {
	private _coverage?: AbstractFileCoverage;
	private readonly el = new Lazy(() => {
		if (this.options.compact) {
			const el = h('.test-coverage-bars.compact', [
				h('.tpc@overall'),
				h('.bar@tpcBar'),
			]);
			this.attachHover(el.tpcBar, getOverallHoverText);
			return el;
		} else {
			const el = h('.test-coverage-bars', [
				h('.tpc@overall'),
				h('.bar@statement'),
				h('.bar@method'),
				h('.bar@branch'),
			]);
			this.attachHover(el.statement, stmtCoverageText);
			this.attachHover(el.method, fnCoverageText);
			this.attachHover(el.branch, branchCoverageText);
			return el;
		}
	});

	private readonly changeEmitter = this._register(new Emitter<void>());
	private readonly visibleStore = this._register(new DisposableStore());

	/**
	 * Event that fires whenver the displayed coverage is shown.
	 */
	public readonly onDidChange = this.changeEmitter.event;

	constructor(
		private readonly options: TestCoverageBarsOptions,
		@IHoverService private readonly hoverService: IHoverService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();
	}

	private attachHover(target: HTMLElement, factory: (coverage: AbstractFileCoverage) => string | IMarkdownString | undefined) {
		target.onmouseenter = () => {
			if (!this._coverage) {
				return;
			}

			const content = factory(this._coverage);
			if (!content) {
				return;
			}

			const hover = this.hoverService.showHover({ content, target });
			if (hover) {
				this.visibleStore.add(hover);
			}
		};
	}

	protected setCoverageInfo(coverage: AbstractFileCoverage | undefined) {
		const ds = this.visibleStore;
		if (!coverage && !this._coverage) {
			if (this._coverage) {
				this._coverage = undefined;
				ds.clear();
				this.changeEmitter.fire();
			}
			return;
		}

		const render = () => {
			const c = coverage!;
			const el = this.el.value;

			const overallStat = calculateDisplayedStat(c, getTestingConfiguration(this.configurationService, TestingConfigKeys.CoveragePercent));
			el.overall.textContent = displayPercent(overallStat);

			if ('tpcBar' in el) { // compact mode
				renderBar(el['tpcBar'], overallStat);
			} else {
				renderBar(el.statement, percent(c.statement));
				renderBar(el.statement, c.function && percent(c.function));
				renderBar(el.statement, c.branch && percent(c.branch));
			}
		};

		render();

		ds.add(this.configurationService.onDidChangeConfiguration(c => {
			if (c.affectsConfiguration(TestingConfigKeys.CoveragePercent)) {
				render();
				this.changeEmitter.fire();
			}
		}));


		if (!this._coverage) {
			this._coverage = coverage;
			const root = this.el.value.root;
			ds.add(toDisposable(() => this.options.container.removeChild(root)));
			this.options.container.appendChild(root);
		}
		this.changeEmitter.fire();
	}
}

const percent = (cc: ICoveredCount) => cc.total === 0 ? 1 : cc.covered / cc.total;
const precision = 2;
const epsilon = 10e-8;

const renderBar = (bar: HTMLElement, pct: number | undefined) => {
	if (pct === undefined) {
		bar.style.display = 'none';
	} else {
		bar.style.display = 'block';
		bar.style.setProperty('--width', `${pct * 100}%`);
		bar.style.color = `var(--${colorThresholds.find(t => pct >= t.threshold)!.color})`;
	}
};

const calculateDisplayedStat = (coverage: AbstractFileCoverage, method: TestingDisplayedCoveragePercent) => {
	switch (method) {
		case TestingDisplayedCoveragePercent.Statement:
			return percent(coverage.statement);
		case TestingDisplayedCoveragePercent.Minimum: {
			let value = percent(coverage.statement);
			if (coverage.branch) { value = Math.min(value, percent(coverage.branch)); }
			if (coverage.function) { value = Math.min(value, percent(coverage.function)); }
			return value;
		}
		case TestingDisplayedCoveragePercent.TotalCoverage:
			return coverage.tpc;
		default:
			assertNever(method);
	}

};

const displayPercent = (value: number) => {
	const display = (value * 100).toFixed(precision);

	// avoid showing 100% coverage if it just rounds up:
	if (value < 1 - epsilon && display === '100') {
		return '99.99%';
	}

	return `${display}%`;
};

const stmtCoverageText = (coverage: AbstractFileCoverage) => localize('statementCoverage', '{} statement coverage', displayPercent(percent(coverage.statement)));
const fnCoverageText = (coverage: AbstractFileCoverage) => coverage.function && localize('functionCoverage', '{} function coverage', displayPercent(percent(coverage.function)));
const branchCoverageText = (coverage: AbstractFileCoverage) => coverage.branch && localize('branchCoverage', '{} branch coverage', displayPercent(percent(coverage.branch)));

const getOverallHoverText = (coverage: AbstractFileCoverage) => new MarkdownString([
	stmtCoverageText(coverage),
	fnCoverageText(coverage),
	branchCoverageText(coverage),
].filter(isDefined).join('\n\n'));
