// @ts-check
const jestConfig = {
    roots: ["<rootDir>"],
    testMatch: [
        '**/lib/**/__tests__/**/*.?(m)[jt]s?(x)',
        '**/lib/**?(*.)+(spec|test).[tj]s?(x)',
    ],
    testEnvironment: 'node',
    transform: {},
}

export default jestConfig
