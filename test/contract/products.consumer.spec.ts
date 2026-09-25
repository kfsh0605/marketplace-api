import path from 'path';
import { Pact, Matchers, SpecificationVersion } from '@pact-foundation/pact';
import { fetchProduct } from './support/products-api-client';

const { like, integer, string } = Matchers;

describe('MarketplaceWebClient -> MarketplaceApi: GET /products/{productId}', () => {
    const provider = new Pact({
        dir: path.resolve(process.cwd(), 'pacts'),
        consumer: 'MarketplaceWebClient',
        provider: 'MarketplaceApi',
        spec: SpecificationVersion.SPECIFICATION_VERSION_V3,
    });

    it('повертає товар за id=1', async () => {
        const expectedBody = {
            id: string('1'),
            name: string('Контрактний товар'),
            priceCents: integer(1999),
            currency: string('UAH'),
        };

        await provider
            .addInteraction()
            .given('Товар з id=1 існує в каталозі')
            .uponReceiving('запит товару за id=1')
            .withRequest('GET', '/products/1', (builder) => {
                builder.headers({ Accept: 'application/json' });
            })
            .willRespondWith(200, (builder) => {
                builder.headers({ 'Content-Type': 'application/json; charset=utf-8' });
                builder.jsonBody(like(expectedBody));
            })
            .executeTest(async (mockserver) => {
                const product = await fetchProduct(mockserver.url, '1');

                expect(product.id).toBe('1');
                expect(typeof product.name).toBe('string');
                expect(typeof product.priceCents).toBe('number');
                expect(product.currency).toBe('UAH');
            });
    });
});