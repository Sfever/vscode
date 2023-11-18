/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { IPrefixTreeNode, WellDefinedPrefixTree } from 'vs/base/common/prefixTree';
import { URI } from 'vs/base/common/uri';
import { CoverageDetails, ICoveredCount, IFileCoverage, emptyCounts, sumCounts } from 'vs/workbench/contrib/testing/common/testTypes';

export interface ICoverageAccessor {
	provideFileCoverage: (token: CancellationToken) => Promise<IFileCoverage[]>;
	resolveFileCoverage: (fileIndex: number, token: CancellationToken) => Promise<CoverageDetails[]>;
}

/** Type of nodes returned from {@link TestCoverage}. Note: value is *always* defined. */
export type TestCoverageFileNode = IPrefixTreeNode<ComputedFileCoverage | FileCoverage>;

/**
 * Class that exposese coverage information for a run.
 */
export class TestCoverage {
	private fileCoverage?: Promise<WellDefinedPrefixTree<FileCoverage | ComputedFileCoverage>>;

	constructor(private readonly accessor: ICoverageAccessor) { }

	/**
	 * Gets coverage information for all files.
	 */
	public async getAllFiles(token = CancellationToken.None) {
		this.fileCoverage ??= this.createFileCoverage(token);

		try {
			return await this.fileCoverage;
		} catch (e) {
			this.fileCoverage = undefined;
			throw e;
		}
	}

	/**
	 * Gets coverage information for a specific file.
	 */
	public async getUri(uri: URI, token = CancellationToken.None) {
		const files = await this.getAllFiles(token);
		return files.find(uri.path.split('/'));
	}

	private *treePathForUri(uri: URI) {
		yield uri.scheme;
		yield uri.authority;
		yield* uri.path.split('/');
	}

	private treePathToUri(path: string[]) {
		return URI.from({ scheme: path[0], authority: path[1], path: path.slice(2).join('/') });
	}

	private async createFileCoverage(token: CancellationToken) {
		const files = await this.accessor.provideFileCoverage(token);
		const tree = new WellDefinedPrefixTree<FileCoverage>();

		// 1. Initial iteration
		for (let i = 0; i < files.length; i++) {
			const file = files[i];
			tree.insert(this.treePathForUri(file.uri), new FileCoverage(file, 0, this.accessor));
		}

		// 2. Depth-first iteration to create computed nodes
		const calculateComputed = (path: string[], node: TestCoverageFileNode): AbstractFileCoverage => {
			if (node.value) {
				return node.value;
			}

			const fileCoverage: IFileCoverage = {
				uri: this.treePathToUri(path),
				statement: emptyCounts(),
			};

			if (node.children) {
				for (const [prefix, child] of node.children) {
					path.push(prefix);
					const v = calculateComputed(path, child);
					path.pop();

					sumCounts(fileCoverage.statement, v.statement);
					if (v.branch) { sumCounts(fileCoverage.branch ??= emptyCounts(), v.branch); }
					if (v.function) { sumCounts(fileCoverage.function ??= emptyCounts(), v.function); }
				}
			}

			return node.value = new ComputedFileCoverage(fileCoverage);
		};

		for (const node of tree.nodes) {
			calculateComputed([], node);
		}

		return tree;
	}
}

export abstract class AbstractFileCoverage {
	public readonly uri: URI;
	public readonly statement: ICoveredCount;
	public readonly branch?: ICoveredCount;
	public readonly function?: ICoveredCount;

	/**
	 * Gets the total coverage percent based on information provided.
	 * This is based on the Clover total coverage formula
	 */
	public get tpc() {
		let numerator = this.statement.covered;
		let denominator = this.statement.total;

		if (this.branch) {
			numerator += this.branch.covered;
			denominator += this.branch.total;
		}

		if (this.function) {
			numerator += this.function.covered;
			denominator += this.function.total;
		}

		return denominator === 0 ? 1 : numerator / denominator;
	}

	constructor(coverage: IFileCoverage) {
		this.uri = URI.revive(coverage.uri);
		this.statement = coverage.statement;
		this.branch = coverage.branch;
		this.function = coverage.branch;
	}
}

/**
 * File coverage info computed from children in the tree, not provided by the
 * extension.
 */
export class ComputedFileCoverage extends AbstractFileCoverage { }

export class FileCoverage extends AbstractFileCoverage {
	private _details?: CoverageDetails[] | Promise<CoverageDetails[]>;

	constructor(coverage: IFileCoverage, private readonly index: number, private readonly accessor: ICoverageAccessor) {
		super(coverage);
		this._details = coverage.details;
	}

	/**
	 * Gets per-line coverage details.
	 */
	public async details(token = CancellationToken.None) {
		this._details ??= this.accessor.resolveFileCoverage(this.index, token);

		try {
			return await this._details;
		} catch (e) {
			this._details = undefined;
			throw e;
		}
	}
}
