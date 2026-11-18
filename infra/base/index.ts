import * as aws from "@pulumi/aws";

// Скелет стека base. Ресурсов пока нет: бюджет добавляется следующим коммитом
// и обязан идти раньше любой сети (ТЗ, критерий C1).
// Два вызова ниже - data source, они ничего не создают, а лишь показывают,
// под каким аккаунтом и в каком регионе работает провайдер.
const identity = aws.getCallerIdentityOutput({});
const region = aws.getRegionOutput({});

export const accountId = identity.accountId;
export const regionName = region.name;
