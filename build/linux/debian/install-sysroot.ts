/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';
import { DebianArchString } from './types';
import * as util from '../../lib/util';
import { fetchGithub } from '../../lib/fetch';

// Based on https://source.chromium.org/chromium/chromium/src/+/main:build/linux/sysroot_scripts/install-sysroot.py.
const URL_PREFIX = 'https://msftelectron.blob.core.windows.net';
const URL_PATH = 'sysroots/toolchain';
const REPO_ROOT = path.dirname(path.dirname(path.dirname(__dirname)));

function getSha(filename: fs.PathLike): string {
	const hash = createHash('sha1');
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

function getVSCodeSysrootChecksum(expectedName: string) {
	const checksums = fs.readFileSync(path.join(REPO_ROOT, 'build', 'checksums', 'vscode-sysroot.txt'), 'utf8');
	for (const line of checksums.split('\n')) {
		const [checksum, name] = line.split(/\s+/);
		if (name === expectedName) {
			return checksum;
		}
	}
	return undefined;
}

type SysrootDictEntry = {
	Sha1Sum: string;
	SysrootDir: string;
	Tarball: string;
};

export async function getVSCodeSysroot(arch: DebianArchString): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		let expectedName: string;
		let triple: string;
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
		const sysroot = path.join(tmpdir(), `vscode-${arch}-sysroot`);
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

		fetchGithub(product.sysrootRepository, { version: '20231120-245067', name: expectedName, path: sysroot, checksumSha256 })
			.pipe(gunzip())
			.pipe(untar())
			.pipe(gulp.dest(sysroot))
			.on('end', () => {
				fs.writeFileSync(stamp, expectedName);
				resolve(`${sysroot}/${triple}/${triple}/sysroot`);
			})
			.on('error', (error: Error) => {
				reject(error);
			});
	});
}

export async function getChromiumSysroot(arch: DebianArchString): Promise<string> {
	const sysrootJSONUrl = `https://raw.githubusercontent.com/electron/electron/v${util.getElectronVersion().electronVersion}/script/sysroots.json`;
	const sysrootDictLocation = `${tmpdir()}/sysroots.json`;
	const result = spawnSync('curl', [sysrootJSONUrl, '-o', sysrootDictLocation]);
	if (result.status !== 0) {
		throw new Error('Cannot retrieve sysroots.json. Stderr:\n' + result.stderr);
	}
	const sysrootInfo = require(sysrootDictLocation);
	const sysrootArch = arch === 'armhf' ? 'bullseye_arm' : `bullseye_${arch}`;
	const sysrootDict: SysrootDictEntry = sysrootInfo[sysrootArch];
	const tarballFilename = sysrootDict['Tarball'];
	const tarballSha = sysrootDict['Sha1Sum'];
	const sysroot = path.join(tmpdir(), sysrootDict['SysrootDir']);
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
		await new Promise<void>((c) => {
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

	const proc = spawnSync('tar', ['xf', tarball, '-C', sysroot]);
	if (proc.status) {
		throw new Error('Tarball extraction failed with code ' + proc.status);
	}
	fs.rmSync(tarball);
	fs.writeFileSync(stamp, url);
	return sysroot;
}
