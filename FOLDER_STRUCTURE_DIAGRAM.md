trade-bot/
├── .env.example
├── .gitignore
├── .prettierignore
├── .prettierrc
├── LICENSE
├── nginx.site.example
├── NOTICE
├── package-lock.json
├── package.json
├── README.md
├── backend/
│   ├── .eslintrc.js
│   ├── eslint.config.js
│   ├── jest.config.js
│   ├── package.json
│   ├── README.md
│   ├── tsconfig.json
│   ├── logs/
│   ├── src/
│   │   ├── index.ts
│   │   ├── config/
│   │   │   └── cache.config.ts
│   │   ├── core/
│   │   │   ├── auth/
│   │   │   │   ├── auth.service.ts
│   │   │   │   ├── index.ts
│   │   │   │   └── role-management.service.ts
│   │   │   ├── logging/
│   │   │   │   ├── context-aware-logger.service.ts
│   │   │   │   ├── index.ts
│   │   │   │   └── logger.service.ts
│   │   │   ├── notifications/
│   │   │   │   ├── error-notification.service.ts
│   │   │   │   ├── index.ts
│   │   │   ├── trading/
│   │   │   │   ├── bot-performance.service.ts
│   │   │   │   ├── bot-status.service.ts
│   │   │   │   ├── engine-manager.service.ts
│   │   │   │   ├── index.ts
│   │   │   │   ├── position-sync.service.ts
│   │   │   │   ├── position-validator.service.ts
│   │   │   │   ├── engine/
│   │   │   ├── user/
│   │   │   │   ├── index.ts
│   │   │   │   ├── user-kodiak.service.ts
│   │   │   │   └── user-profile.service.ts
│   │   │   ├── wallet/
│   │   │   │   ├── balance.service.ts
│   │   │   │   ├── index.ts
│   │   │   │   └── wallet-qualification.service.ts
│   │   ├── database/
│   │   │   ├── index.ts
│   │   │   ├── migrate.ts
│   │   │   └── pool.ts
│   │   ├── infrastructure/
│   │   │   ├── index.ts
│   │   │   ├── retry.service.ts
│   │   │   ├── async/
│   │   │   │   ├── async-operation-manager.service.ts
│   │   │   │   ├── index.ts
│   │   │   ├── cache/
│   │   │   │   ├── cache-invalidation.service.ts
│   │   │   │   ├── credential-cache.service.ts
│   │   │   │   ├── index.ts
│   │   │   │   ├── redis.service.ts
│   │   │   │   ├── redis/
│   │   │   ├── external/
│   │   │   │   ├── index.ts
│   │   │   │   ├── kodiak-client.ts
│   │   │   │   ├── kodiak-connection.service.ts
│   │   │   │   └── kodiak-integration.service.ts
│   │   │   ├── messaging/
│   │   │   │   ├── index.ts
│   │   │   │   ├── market-stream.service.ts
│   │   │   │   ├── market-stream/
│   │   │   ├── security/
│   │   │   │   ├── database-security.service.ts
│   │   │   │   ├── encryption.service.ts
│   │   │   │   ├── index.ts
│   │   │   │   ├── key-management.service.ts
│   │   │   │   ├── rate-limiter.service.ts
│   │   │   │   ├── rate-limiter/
│   │   ├── interfaces/
│   │   │   ├── index.ts
│   │   │   ├── http/
│   │   │   │   ├── auth.ts
│   │   │   │   ├── balance.ts
│   │   │   │   ├── bot-engine.ts
│   │   │   │   ├── bot-management.ts
│   │   │   │   ├── bot.ts
│   │   │   │   ├── health.ts
│   │   │   │   ├── index.ts
│   │   │   │   ├── market.ts
│   │   │   │   ├── security.ts
│   │   │   │   ├── strategies.ts
│   │   │   │   ├── user-kodiak.ts
│   │   │   │   ├── user-profile.ts
│   │   │   │   ├── user.ts
│   │   │   │   ├── wallet.ts
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts
│   │   │   │   ├── context.ts
│   │   │   │   ├── csrf.ts
│   │   │   │   ├── index.ts
│   │   │   ├── websocket/
│   │   ├── lib/
│   │   ├── shared/
│   │   │   ├── index.ts
│   │   │   ├── constants/
│   │   │   ├── types/
│   │   │   ├── utils/
│   │   │   ├── validation/
│   │   ├── workers/
│   │   │   ├── bot-reconciliation.ts
│   │   │   ├── index.ts
│   │   │   ├── password-worker.ts
│   ├── tests/
│   │   ├── setup.ts
│   │   ├── unit/
│   │   │   └── middleware.auth.test.ts
├── database/
│   └── migrations/
├── docs/
├── engine/
│   └── kodiak/
│       ├── .eslintrc.js
│       ├── eslint.config.js
│       ├── package.json
│       ├── README.md
│       ├── tsconfig.json
│       ├── src/
│       │   ├── index.ts
│       │   ├── services/
│       │   ├── strategies/
│       │   ├── types/
│       │   └── utils/
├── frontend/
│   ├── eslint.config.js
│   ├── index.html
│   ├── package.json
│   ├── README.md
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   ├── vite.config.ts
│   ├── public/
│   │   └── maintenance.html
│   ├── src/
│   │   ├── App.tsx
│   │   ├── index.css
│   │   ├── main.tsx
│   │   ├── vite-env.d.ts
│   │   ├── components/
│   │   │   ├── CandlestickChart.tsx
│   │   │   ├── PriceChart.tsx
│   │   │   ├── StrategyForm.tsx
│   │   │   ├── WalletConnectDialog.tsx
│   │   │   ├── ui/
│   │   ├── contexts/
│   │   │   ├── ErrorContext.tsx
│   │   │   ├── ThemeContext.tsx
│   │   ├── features/
│   │   │   ├── analytics/
│   │   │   ├── auth/
│   │   │   ├── dashboard/
│   │   │   ├── settings/
│   │   │   ├── trading/
│   │   ├── infrastructure/
│   │   │   ├── api/
│   │   │   ├── cache/
│   │   │   ├── websocket/
│   │   ├── lib/
│   │   │   ├── api.ts
│   │   │   ├── toast.ts
│   │   ├── shared/
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   ├── utils/
│   │   │   ├── validation/
│   │   ├── styles/
│   │   │   ├── base.css
│   │   │   ├── components.css
│   │   │   ├── critical.css
│   │   │   ├── layouts.css
│   │   │   ├── patterns.css
│   │   │   ├── styled-theme.ts
│   │   │   └── utilities.css
├── scripts/
│   ├── fix-imports.js
│   ├── run-migrations.js
│   ├── security-test.sh
│   ├── verify-phase4.sh
└── shared/
    ├── .eslintrc.js
    ├── eslint.config.js
    ├── package.json
    ├── tsconfig.cjs.json
    ├── tsconfig.json
    └── src/
        └── index.ts
