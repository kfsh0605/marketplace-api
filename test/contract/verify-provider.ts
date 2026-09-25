import 'reflect-metadata';
import { resolve } from 'path';
import { Verifier } from '@pact-foundation/pact';
import { DataSource } from 'typeorm';
import { bootstrapE2eApp } from '../e2e/testkit/bootstrap-app';
import { Product } from '../../src/entities/product.entity';

const PROVIDER_PORT = 3123;

async function seedContractProduct(dataSource: DataSource): Promise<void> {
    const repo = dataSource.getRepository(Product);
    const existing = await repo.findOneBy({ id: 1 });

    if (!existing) {
        await repo.save(
            repo.create({
                id: 1,
                name: 'Контрактний товар',
                priceCents: 1999,
                stock: 100,
                currency: 'UAH',
            }),
        );
    }
}

async function main(): Promise<void> {
    const e2e = await bootstrapE2eApp();
    await e2e.app.listen(PROVIDER_PORT);

    const brokerUrl = process.env.PACT_BROKER_URL;
    const providerVersion = process.env.PACT_PROVIDER_VERSION || '0.0.0-local';

    const verifier = new Verifier({
        provider: 'MarketplaceApi',
        providerBaseUrl: `http://127.0.0.1:${PROVIDER_PORT}`,
        stateHandlers: {
            'Товар з id=1 існує в каталозі': async () => {
                await seedContractProduct(e2e.dataSource);
            },
        },
        ...(brokerUrl
            ? {
                pactBrokerUrl: brokerUrl,
                ...(process.env.PACT_BROKER_TOKEN ? { pactBrokerToken: process.env.PACT_BROKER_TOKEN } : {}),
                consumerVersionSelectors: [{ latest: true }],
                publishVerificationResult: true,
                providerVersion,
            }
            : {
                pactUrls: [resolve(process.cwd(), 'pacts', 'MarketplaceWebClient-MarketplaceApi.json')],
            }),
    });

    try {
        await verifier.verifyProvider();
        console.log('Provider verification: OK');
    } finally {
        await e2e.close();
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});