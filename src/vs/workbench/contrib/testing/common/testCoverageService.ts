/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IObservable, ISettableObservable, observableValue } from 'vs/base/common/observable';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IViewsService } from 'vs/workbench/common/views';
import { Testing } from 'vs/workbench/contrib/testing/common/constants';
import { TestCoverage } from 'vs/workbench/contrib/testing/common/testCoverage';
import { TestingContextKeys } from 'vs/workbench/contrib/testing/common/testingContextKeys';


export const ITestCoverageService = createDecorator<ITestCoverageService>('testProfileService');

export interface ITestCoverageService {
	readonly _serviceBrand: undefined;

	/**
	 * Settable observable that can be used to show the test coverage instance
	 * currently in the editor.
	 */
	readonly selected: IObservable<TestCoverage | undefined>;

	/**
	 * Opens a test coverage report, optionally focusing it in the editor.
	 */
	openCoverage(coverage: TestCoverage, focus?: boolean): void;

	/**
	 * Closes any open coverage.
	 */
	closeCoverage(): void;
}

export class TestCoverageService implements ITestCoverageService extends Disposable {
	declare readonly _serviceBrand: undefined;
	private readonly _isOpenKey: IContextKey<boolean>;

	public readonly selected = observableValue<TestCoverage | undefined>('testCoverage', undefined);

	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewsService private readonly viewsService: IViewsService,
	) {
		super();
		this._isOpenKey = TestingContextKeys.isTestCoverageOpen.bindTo(contextKeyService);
	}

	/** @inheritdoc */
	public openCoverage(coverage: TestCoverage, focus = true) {
		this._isOpenKey.set(true);
		this.selected.set(coverage, undefined);

		if (focus) {
			this.viewsService.openView(Testing.CoverageViewId, true);
		}
	}

	/** @inheritdoc */
	public closeCoverage() {
		this._isOpenKey.set(false);
		this.selected.set(undefined, undefined);
	}
}
