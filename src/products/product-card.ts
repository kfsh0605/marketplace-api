export interface ProductCard {
    id: string;
    name: string;
    priceCents: number;
    currency: string;
    stock: number;
    unitsSold: number;
    revenueCents: number;
    ordersCount: number;
}

export const CARD_QUERY_TAG = 'product-card';

export const cardKey = (productId: number): string => `product:card:${productId}`;