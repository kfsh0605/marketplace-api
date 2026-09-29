export interface ConsumerProduct {
    id: string;
    name: string;
    priceCents: number;
    currency: string;
}

export async function fetchProduct(baseUrl: string, productId: string): Promise<ConsumerProduct> {
    const response = await fetch(`${baseUrl}/products/${productId}`, {
        headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
        throw new Error(`MarketplaceWebClient: неочікуваний статус ${response.status} від GET /products/${productId}`);
    }

    return (await response.json()) as ConsumerProduct;
}