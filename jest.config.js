const tsJestTransformer = [
    'ts-jest',
    {
        tsconfig: {
            module: 'commonjs',
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
            types: ['jest', 'node'],
        },
    },
];

const plainTsTransform = {
    '^.+\\.tsx?$': tsJestTransformer,
};

module.exports = {
    reporters: ['default'],
    maxWorkers: 1,
    testTimeout: 60000,
    projects: [
        {
            displayName: 'integration',
            testEnvironment: 'node',
            rootDir: '.',
            testMatch: ['<rootDir>/test/integration/**/*.spec.ts'],
            setupFiles: ['reflect-metadata'],
            transform: plainTsTransform,
        },
        {
            displayName: 'e2e',
            testEnvironment: 'node',
            rootDir: '.',
            testMatch: ['<rootDir>/test/e2e/**/*.spec.ts'],
            setupFiles: ['reflect-metadata'],
            transform: plainTsTransform,
        },
        {
            displayName: 'contract',
            testEnvironment: 'node',
            rootDir: '.',
            testMatch: ['<rootDir>/test/contract/**/*.consumer.spec.ts'],
            setupFiles: ['reflect-metadata'],
            transform: plainTsTransform,
        },
    ],
};