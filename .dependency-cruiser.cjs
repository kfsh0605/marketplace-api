/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
    forbidden: [
        {
            name: 'domain-not-to-http',
            comment:
                'Домен (сутності, outbox, брокер повідомлень) не знає про HTTP-шар: контролери й gateway залежать від домену, ' +
                'а не навпаки. Інакше зміна маршруту ламає бізнес-логіку.',
            severity: 'error',
            from: { path: '(^|/)src/(entities|outbox|messaging)/' },
            to: { path: '\\.(controller|gateway)\\.ts$' },
        },
        {
            name: 'prod-not-to-demo',
            comment: 'Демо-скрипти (src/demo-*.ts) запускаються руками; прод-код не має від них залежати.',
            severity: 'error',
            from: { path: '(^|/)src/(?!demo-)', pathNot: '(^|/)src/lib/.*demo' },
            to: { path: '(^|/)src/demo-' },
        },
        {
            name: 'src-not-to-test',
            comment: 'Код застосунку не імпортує тести.',
            severity: 'error',
            from: { path: '(^|/)src/' },
            to: { path: '(^|/)test/' },
        },
    ],
    options: {
        doNotFollow: { path: 'node_modules' },
        tsPreCompilationDeps: true,
        tsConfig: { fileName: 'tsconfig.json' },
        exclude: { path: '(^|/)(dist|node_modules|migrations)/' },
    },
};
