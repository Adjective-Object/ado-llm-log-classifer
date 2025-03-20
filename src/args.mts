import { fileExists, mkdirp } from "./fs-helpers.mjs";
import * as fs from 'node:fs';
import minimist from "minimist";
import input from "@inquirer/input";
import path from "node:path";

export type ArgDescriptor = {
    shortName: string;
    helpDescription: string;
};
export type RequiredArgDescriptor = ArgDescriptor & ({
    missingPrompt: string;
} | { default: string });
export type ArgDescriptors<TArgs extends {[key: string]: string}> = { [K in keyof TArgs]: undefined extends TArgs[K] ? ArgDescriptor : RequiredArgDescriptor };

export function printHelp(binName: string, argDescriptors: ArgDescriptors<any>) {
    let msgParts = [
        `Usage: ${binName} [options]\n`,
        `Options:\n`
    ];
    for (const [argName, argDescriptor] of Object.entries(argDescriptors)) {
        msgParts.push(`  -${argDescriptor.shortName}, --${argName}: ${argDescriptor.helpDescription}\n`);
    }
    console.log(msgParts.join(''));
}

export async function parseArgs<TArgs extends {[key: string]: string}>(
    binName: string,
    argDescriptors: ArgDescriptors<TArgs>,
    argsSaveName: (args: Partial<TArgs>) => string,
): Promise<TArgs|undefined> {
    const rawArgs = minimist(process.argv.slice(2));
    let parsedArgs: Partial<TArgs> = {};
    
    if (rawArgs.help) {
        // early exit if the help flag is set, because we don't want to prompt or save other args
        printHelp(binName, argDescriptors);
        return undefined;
    }
    
    // populate the default args from the argDescriptors
    for (let [argName, argDescriptor] of Object.entries(argDescriptors) as [keyof TArgs, ArgDescriptor | RequiredArgDescriptor][]) {
        if (argName in rawArgs) {
            parsedArgs[argName] = rawArgs[argName as any];
        } else if ('default' in argDescriptor) {
            parsedArgs[argName] = argDescriptor.default as any;
        }
    }
    
    // open the old args if they exist
    let argsSavePath = argsSaveName(parsedArgs);
    if (await fileExists(argsSavePath)) {
        let oldArgs = JSON.parse(await
            fs.promises.readFile(argsSavePath, { encoding: 'utf-8' }));
        console.log(`Found old args at ${argsSavePath}, using them as defaults`);
        for (let [argName, argValue] of Object.entries(oldArgs)) {
            if (!rawArgs[argName]) {
                (parsedArgs as any)[argName] = argValue;
            }
        }
    }

    for (let [argName, argDescriptor] of Object.entries(argDescriptors)) {
        let descriptor = argDescriptor as RequiredArgDescriptor | ArgDescriptor;
        if (argName in parsedArgs) {
            continue;
        }

        if ('missingPrompt' in descriptor) {
            let value = await input({
                message: descriptor.missingPrompt,
                required: true,
            })
            parsedArgs[argName as keyof TArgs] = value as any
        }
    }

    // save the args to the file
    await mkdirp(path.dirname(argsSavePath));
    await fs.promises.writeFile(
        argsSavePath,
        JSON.stringify(parsedArgs, null, 2),
        { encoding: 'utf-8' },
    );
    return parsedArgs as TArgs;
}