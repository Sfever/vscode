"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.getChromiumSysroot = exports.getVSCodeSysroot = void 0;
const child_process_1 = require("child_process");
const crypto_1 = require("crypto");
const os_1 = require("os");
const fs = require("fs");
const https = require("https");
const path = require("path");
const util = require("../../lib/util");
const fetch_1 = require("../../lib/fetch");
// Based on https://source.chromium.org/chromium/chromium/src/+/main:build/linux/sysroot_scripts/install-sysroot.py.
const URL_PREFIX = 'https://msftelectron.blob.core.windows.net';
const URL_PATH = 'sysroots/toolchain';
const REPO_ROOT = path.dirname(path.dirname(path.dirname(__dirname)));
function getSha(filename) {
    const hash = (0, crypto_1.createHash)('sha1');
    // Read file 1 MB at a time
    const fd = fs.openSync(filename, 'r');
    const buffer = Buffer.alloc(1024 * 1024);
    let position = 0;
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(fd, buffer, 0, buffer.length, position)) === buffer.length) {
        hash.update(buffer);
        position += bytesRead;
    }
    hash.update(buffer.slice(0, bytesRead));
    return hash.digest('hex');
}
function getVSCodeSysrootChecksum(expectedName) {
    const checksums = fs.readFileSync(path.join(REPO_ROOT, 'build', 'checksums', 'vscode-sysroot.txt'), 'utf8');
    for (const line of checksums.split('\n')) {
        const [checksum, name] = line.split(/\s+/);
        if (name === expectedName) {
            return checksum;
        }
    }
    return undefined;
}
async function getVSCodeSysroot(arch) {
    return new Promise((resolve, reject) => {
        let expectedName;
        let triple;
        switch (arch) {
            case 'amd64':
                expectedName = `x86_64-vscode-linux-gnu.tar.gz`;
                triple = 'x86_64-vscode-linux-gnu';
                break;
            case 'arm64':
                expectedName = `aarch64-vscode-linux-gnu.tar.gz`;
                triple = 'aarch64-vscode-linux-gnu';
                break;
            case 'armhf':
                expectedName = `arm-vscode-linux-gnueabihf.tar.gz`;
                triple = 'arm-vscode-linux-gnueabihf';
                break;
        }
        const checksumSha256 = getVSCodeSysrootChecksum(expectedName);
        if (!checksumSha256) {
            reject(new Error(`Could not find checksum for ${expectedName}`));
            return;
        }
        const sysroot = path.join((0, os_1.tmpdir)(), `vscode-${arch}-sysroot`);
        const stamp = path.join(sysroot, '.stamp');
        if (fs.existsSync(stamp) && fs.readFileSync(stamp).toString() === expectedName) {
            resolve(sysroot);
            return;
        }
        console.log(`Installing ${arch} root image: ${sysroot}`);
        fs.rmSync(sysroot, { recursive: true, force: true });
        fs.mkdirSync(sysroot);
        const gulp = require('gulp');
        const gunzip = require('gulp-gunzip');
        const untar = require('gulp-untar');
        const product = require(path.join(REPO_ROOT, 'product.json'));
        (0, fetch_1.fetchGithub)(product.sysrootRepository, { version: '20231120-245067', name: expectedName, path: sysroot, checksumSha256 })
            .pipe(gunzip())
            .pipe(untar())
            .pipe(gulp.dest(sysroot))
            .on('end', () => {
            fs.writeFileSync(stamp, expectedName);
            resolve(`${sysroot}/${triple}/${triple}/sysroot`);
        })
            .on('error', (error) => {
            reject(error);
        });
    });
}
exports.getVSCodeSysroot = getVSCodeSysroot;
async function getChromiumSysroot(arch) {
    const sysrootJSONUrl = `https://raw.githubusercontent.com/electron/electron/v${util.getElectronVersion().electronVersion}/script/sysroots.json`;
    const sysrootDictLocation = `${(0, os_1.tmpdir)()}/sysroots.json`;
    const result = (0, child_process_1.spawnSync)('curl', [sysrootJSONUrl, '-o', sysrootDictLocation]);
    if (result.status !== 0) {
        throw new Error('Cannot retrieve sysroots.json. Stderr:\n' + result.stderr);
    }
    const sysrootInfo = require(sysrootDictLocation);
    const sysrootArch = arch === 'armhf' ? 'bullseye_arm' : `bullseye_${arch}`;
    const sysrootDict = sysrootInfo[sysrootArch];
    const tarballFilename = sysrootDict['Tarball'];
    const tarballSha = sysrootDict['Sha1Sum'];
    const sysroot = path.join((0, os_1.tmpdir)(), sysrootDict['SysrootDir']);
    const url = [URL_PREFIX, URL_PATH, tarballSha, tarballFilename].join('/');
    const stamp = path.join(sysroot, '.stamp');
    if (fs.existsSync(stamp) && fs.readFileSync(stamp).toString() === url) {
        return sysroot;
    }
    console.log(`Installing Debian ${arch} root image: ${sysroot}`);
    fs.rmSync(sysroot, { recursive: true, force: true });
    fs.mkdirSync(sysroot);
    const tarball = path.join(sysroot, tarballFilename);
    console.log(`Downloading ${url}`);
    let downloadSuccess = false;
    for (let i = 0; i < 3 && !downloadSuccess; i++) {
        fs.writeFileSync(tarball, '');
        await new Promise((c) => {
            https.get(url, (res) => {
                res.on('data', (chunk) => {
                    fs.appendFileSync(tarball, chunk);
                });
                res.on('end', () => {
                    downloadSuccess = true;
                    c();
                });
            }).on('error', (err) => {
                console.error('Encountered an error during the download attempt: ' + err.message);
                c();
            });
        });
    }
    if (!downloadSuccess) {
        fs.rmSync(tarball);
        throw new Error('Failed to download ' + url);
    }
    const sha = getSha(tarball);
    if (sha !== tarballSha) {
        throw new Error(`Tarball sha1sum is wrong. Expected ${tarballSha}, actual ${sha}`);
    }
    const proc = (0, child_process_1.spawnSync)('tar', ['xf', tarball, '-C', sysroot]);
    if (proc.status) {
        throw new Error('Tarball extraction failed with code ' + proc.status);
    }
    fs.rmSync(tarball);
    fs.writeFileSync(stamp, url);
    return sysroot;
}
exports.getChromiumSysroot = getChromiumSysroot;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5zdGFsbC1zeXNyb290LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiaW5zdGFsbC1zeXNyb290LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7O2dHQUdnRzs7O0FBRWhHLGlEQUEwQztBQUMxQyxtQ0FBb0M7QUFDcEMsMkJBQTRCO0FBQzVCLHlCQUF5QjtBQUN6QiwrQkFBK0I7QUFDL0IsNkJBQTZCO0FBRTdCLHVDQUF1QztBQUN2QywyQ0FBOEM7QUFFOUMsb0hBQW9IO0FBQ3BILE1BQU0sVUFBVSxHQUFHLDRDQUE0QyxDQUFDO0FBQ2hFLE1BQU0sUUFBUSxHQUFHLG9CQUFvQixDQUFDO0FBQ3RDLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUV0RSxTQUFTLE1BQU0sQ0FBQyxRQUFxQjtJQUNwQyxNQUFNLElBQUksR0FBRyxJQUFBLG1CQUFVLEVBQUMsTUFBTSxDQUFDLENBQUM7SUFDaEMsMkJBQTJCO0lBQzNCLE1BQU0sRUFBRSxHQUFHLEVBQUUsQ0FBQyxRQUFRLENBQUMsUUFBUSxFQUFFLEdBQUcsQ0FBQyxDQUFDO0lBQ3RDLE1BQU0sTUFBTSxHQUFHLE1BQU0sQ0FBQyxLQUFLLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQyxDQUFDO0lBQ3pDLElBQUksUUFBUSxHQUFHLENBQUMsQ0FBQztJQUNqQixJQUFJLFNBQVMsR0FBRyxDQUFDLENBQUM7SUFDbEIsT0FBTyxDQUFDLFNBQVMsR0FBRyxFQUFFLENBQUMsUUFBUSxDQUFDLEVBQUUsRUFBRSxNQUFNLEVBQUUsQ0FBQyxFQUFFLE1BQU0sQ0FBQyxNQUFNLEVBQUUsUUFBUSxDQUFDLENBQUMsS0FBSyxNQUFNLENBQUMsTUFBTSxFQUFFLENBQUM7UUFDNUYsSUFBSSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUNwQixRQUFRLElB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