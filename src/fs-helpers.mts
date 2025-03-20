import * as fs from 'node:fs'

export function fileExists(filePath: string): Promise<boolean> {
    return fs.promises.stat(filePath).then(x => x.isFile()).catch(() => false)
}

export function mkdirp(dirPath: string): Promise<string|void|undefined> {
    return fs.promises.mkdir(dirPath, { recursive: true }).catch((err) => {
        if (err.code !== 'EEXIST') {
            throw err;
        }
    })
}