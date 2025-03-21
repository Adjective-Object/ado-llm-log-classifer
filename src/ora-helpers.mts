import type { Ora } from 'ora';
import ora from 'ora';

export function catchOra(spinner: Ora) {
    return (err: Error) => {
        spinner.fail();
        throw err;
    };
}

export async function withOra<T>(
    promise: Promise<T>,
    message: string,
): Promise<T> {
    const spinner = ora(message).start();
    try {
        const result = await promise;
        spinner.succeed(message);
        return result;
    } catch (err) {
        spinner.fail(message);
        throw err;
    }
}