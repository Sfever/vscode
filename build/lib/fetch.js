"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchGithub = exports.fetchUrl = exports.fetchUrls = void 0;
const es = require("event-stream");
const VinylFile = require("vinyl");
const log = require("fancy-log");
const ansiColors = require("ansi-colors");
const crypto = require("crypto");
const through2 = require("through2");
const path = require("path");
function fetchUrls(urls, options) {
    if (options === undefined) {
        options = {};
    }
    if (typeof options.base !== 'string' && options.base !== null) {
        options.base = '/';
    }
    if (!Array.isArray(urls)) {
        urls = [urls];
    }
    return es.readArray(urls).pipe(es.map((data, cb) => {
        const url = [options.base, data].join('');
        fetchUrl(url, options).then(file => {
            cb(undefined, file);
        }, error => {
            cb(error);
        });
    }));
}
exports.fetchUrls = fetchUrls;
async function fetchUrl(url, options, retries = 10, retryDelay = 1000) {
    const verbose = !!options.verbose ?? (!!process.env['CI'] || !!process.env['BUILD_ARTIFACTSTAGINGDIRECTORY']);
    try {
        let startTime = 0;
        if (verbose) {
            log(`Start fetching ${ansiColors.magenta(url)}${retries !== 10 ? `(${10 - retries} retry}` : ''}`);
            startTime = new Date().getTime();
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30 * 1000);
        try {
            const response = await fetch(url, {
                ...options.nodeFetchOptions,
                signal: controller.signal /* Typings issue with lib.dom.d.ts */
            });
            if (verbose) {
                log(`Fetch completed: Status ${response.status}. Took ${ansiColors.magenta(`${new Date().getTime() - startTime} ms`)}`);
            }
            if (response.ok && (response.status >= 200 && response.status < 300)) {
                const contents = Buffer.from(await response.arrayBuffer());
                if (options.checksumSha256) {
                    const actualSHA256Checksum = crypto.createHash('sha256').update(contents).digest('hex');
                    if (actualSHA256Checksum !== options.checksumSha256) {
                        throw new Error(`Checksum mismatch for ${ansiColors.cyan(url)} (expected ${options.checksumSha256}, actual ${actualSHA256Checksum}))`);
                    }
                    else if (verbose) {
                        log(`Verified SHA256 checksums match for ${ansiColors.cyan(url)}`);
                    }
                }
                else if (verbose) {
                    log(`Skipping checksum verification for ${ansiColors.cyan(url)} because no expected checksum was provided`);
                }
                if (verbose) {
                    log(`Fetched response body buffer: ${ansiColors.magenta(`${contents.byteLength} bytes`)}`);
                }
                return new VinylFile({
                    cwd: '/',
                    base: options.path ? path.dirname(options.path) : options.base,
                    path: options.path ?? url,
                    contents
                });
            }
            throw new Error(`Request ${ansiColors.magenta(url)} failed with status code: ${response.status}`);
        }
        finally {
            clearTimeout(timeout);
        }
    }
    catch (e) {
        if (verbose) {
            log(`Fetching ${ansiColors.cyan(url)} failed: ${e}`);
        }
        if (retries > 0) {
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            return fetchUrl(url, options, retries - 1, retryDelay);
        }
        throw e;
    }
}
exports.fetchUrl = fetchUrl;
const ghApiHeaders = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'VSCode Build',
};
if (process.env.GITHUB_TOKEN) {
    ghApiHeaders.Authorization = 'Basic ' + Buffer.from(process.env.GITHUB_TOKEN).toString('base64');
}
const ghDownloadHeaders = {
    ...ghApiHeaders,
    Accept: 'application/octet-stream',
};
/**
 * @param repo for example `Microsoft/vscode`
 * @param version for example `16.17.1` - must be a valid releases tag
 * @param assetName for example (name) => name === `win-x64-node.exe` - must be an asset that exists
 * @returns a stream with the asset as file
 */
function fetchGithub(repo, options) {
    return fetchUrls(`/repos/${repo.replace(/^\/|\/$/g, '')}/releases/tags/v${options.version}`, {
        base: 'https://api.github.com',
        verbose: options.verbose,
        path: options.path,
        nodeFetchOptions: { headers: ghApiHeaders }
    }).pipe(through2.obj(async function (file, _enc, callback) {
        const assetFilter = typeof options.name === 'string' ? (name) => name === options.name : options.name;
        const asset = JSON.parse(file.contents.toString()).assets.find((a) => assetFilter(a.name));
        if (!asset) {
            return callback(new Error(`Could not find asset in release of ${repo} @ ${options.version}`));
        }
        try {
            callback(null, await fetchUrl(asset.url, {
                nodeFetchOptions: { headers: ghDownloadHeaders },
                verbose: options.verbose,
                path: options.path,
                checksumSha256: options.checksumSha256
            }));
        }
        catch (error) {
            callback(error);
        }
    }));
}
exports.fetchGithub = fetchGithub;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZmV0Y2guanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJmZXRjaC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7OztnR0FHZ0c7OztBQUVoRyxtQ0FBbUM7QUFDbkMsbUNBQW1DO0FBQ25DLGlDQUFpQztBQUNqQywwQ0FBMEM7QUFDMUMsaUNBQWlDO0FBQ2pDLHFDQUFxQztBQUNyQyw2QkFBNkI7QUFXN0IsU0FBZ0IsU0FBUyxDQUFDLElBQXVCLEVBQUUsT0FBc0I7SUFDeEUsSUFBSSxPQUFPLEtBQUssU0FBUyxFQUFFLENBQUM7UUFDM0IsT0FBTyxHQUFHLEVBQUUsQ0FBQztJQUNkLENBQUM7SUFFRCxJQUFJLE9BQU8sT0FBTyxDQUFDLElBQUksS0FBSyxRQUFRLElBQUksT0FBTyxDQUFDLElBQUksS0FBSyxJQUFJLEVBQUUsQ0FBQztRQUMvRCxPQUFPLENBQUMsSUFBSSxHQUFHLEdBQUcsQ0FBQztJQUNwQixDQUFDO0lBRUQsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztRQUMxQixJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUNmLENBQUM7SUFFRCxPQUFPLEVBQUUsQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQTJCLENBQUMsSUFBWSxFQUFFLEVBQUUsRUFBRSxFQUFFO1FBQ3BGLE1BQU0sR0FBRyxHQUFHLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUM7UUFDMUMsUUFBUSxDQUFDLEdBQUcsRUFBRSxPQUFPLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUU7WUFDbEMsRUFBRSxDQUFDLFNBQVMsRUFBRSxJQUFJLENBQUMsQ0FBQztRQUNyQixDQUFDLEVBQUUsS0FBSyxDQUFDLEVBQUU7WUFDVixFQUFFLENBQUMsS0FBSyxDQUFDLENBQUM7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