# Frontend React Application

**React 19 UI Dashboard for Trade Bot with Real-Time Charts**

[![React](https://img.shields.io/badge/React-19.2-blue)](package.json)
[![Vite](https://img.shields.io/badge/Vite-7.x-646CFF)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](package.json)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.x-38B2AC)](package.json)

---

## Overview

The frontend is a modern React 19 single-page application (SPA) built with Vite, providing a real-time trading dashboard with interactive charts, strategy management, and bot monitoring capabilities.

### Key Features

- **Real-Time Charts** - Interactive candlestick charts with TradingView integration
- **Strategy Builder** - Visual strategy configuration interface
- **Bot Management** - Live bot status monitoring and control
- **Market Data** - Real-time price feeds and market statistics
- **Responsive Design** - Mobile-first design with Tailwind CSS
- **WebSocket Integration** - Live updates for bot status and market data
- **Authentication** - Secure JWT-based user authentication
- **Type Safety** - Full TypeScript coverage

---

## Quick Start

### Prerequisites
- Node.js ≥ 25.0.9
- Backend API running (see [Backend Docs](../backend/README.md))

### Installation

```bash
cd frontend
npm install
```

### Configuration

Create `.env` in the frontend directory:

```bash
# API Configuration
VITE_API_URL=https://yourdomain.com

# Development
VITE_NODE_ENV=development
```

### Development

```bash
# Start development server with hot reload
npm run dev

# Open in browser
# http://localhost:5173
```

### Building

```bash
# Build for production
npm run build

# Preview production build
npm run preview
```

### Testing

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

---

## Technology Stack

### Core Framework
- **React 19.2** - Latest React with concurrent features
- **TypeScript 5** - Full type safety and modern JavaScript features
- **Vite 7** - Fast build tool with HMR and optimized production builds

### UI & Styling
- **Tailwind CSS 4** - Utility-first CSS framework
- **Radix UI** - Accessible, unstyled UI components
- **Lucide React** - Beautiful icon library
- **Framer Motion** - Smooth animations and transitions

### Data & State Management
- **Zustand** - Lightweight, scalable state management
- **TanStack Query** - Powerful data fetching and caching
- **Axios** - HTTP client with interceptors
- **Socket.IO Client** - Real-time WebSocket communication

### Charts & Visualization
- **Lightweight Charts** - High-performance financial charts
- **Recharts** - React charting library for additional visualizations

### Development Tools
- **ESLint** - Code linting and formatting
- **Prettier** - Code formatting
- **Vitest** - Fast unit testing framework
- **Playwright** - End-to-end testing

---

## Project Structure

```
frontend/
├── src/
│   ├── components/           # Reusable UI components
│   │   ├── ui/              # Base UI components (Button, Card, etc.)
│   │   ├── dashboard/       # Dashboard-specific components
│   │   ├── BotControls.tsx  # Bot management interface
│   │   ├── CandlestickChart.tsx # Chart components
│   │   ├── PriceChart.tsx   # Price visualization
│   │   ├── StrategyForm.tsx # Strategy configuration
│   │   └── WalletConnectDialog.tsx # Web3 wallet integration
│   ├── pages/               # Route components
│   │   ├── Dashboard.tsx    # Main dashboard
│   │   ├── Login.tsx        # Authentication
│   │   ├── Register.tsx     # User registration
│   │   ├── Settings.tsx     # User settings
│   │   └── Strategies.tsx   # Strategy management
│   ├── contexts/            # React contexts
│   │   └── AuthContext.tsx  # Authentication state
│   ├── hooks/               # Custom React hooks
│   │   ├── useBalance.ts    # Balance management
│   │   ├── useChartData.ts  # Chart data fetching
│   │   ├── useMarketStream.ts # WebSocket market data
│   │   ├── usePrice.ts      # Price data hooks
│   │   └── useVisibility.ts # Component visibility
│   ├── lib/                 # Utilities and configurations
│   │   ├── api.ts           # API client configuration
│   │   └── utils.ts         # Utility functions
│   ├── stores/              # Zustand state stores
│   │   └── authStore.ts     # Authentication store
│   ├── types/               # TypeScript type definitions
│   ├── App.tsx              # Main application component
│   ├── main.tsx             # Application entry point
│   └── index.css            # Global styles
├── public/                  # Static assets
├── index.html               # HTML template
├── vite.config.ts           # Vite configuration
├── tailwind.config.js       # Tailwind CSS configuration
├── tsconfig.json            # TypeScript configuration
└── package.json
```

---

## Core Components

### Dashboard (`/dashboard`)
Main trading interface with real-time data and controls.

**Features:**
- Live portfolio balance and P&L
- Active bot status monitoring
- Quick strategy controls
- Market overview widgets

### Strategy Management (`/strategies`)
Create, configure, and manage trading strategies.

**Supported Strategies:**
- **Grid Trading** - Automated buy/sell grids
- **Trend Following** - Momentum-based strategies
- **Arbitrage** - Cross-market opportunities
- **Mean Reversion** - Statistical reversion strategies

### Charts & Analytics
Interactive financial charts with multiple timeframes.

**Chart Features:**
- Candlestick charts with volume
- Multiple technical indicators
- Real-time price updates
- Drawing tools and annotations

### Authentication
Secure user authentication with JWT tokens.

**Features:**
- Email/password registration and login
- Automatic token refresh
- Secure logout with token invalidation
- Protected route guards

---

## API Integration

### REST API Client

The frontend uses a centralized API client (`src/lib/api.ts`) with:

- **Automatic authentication** - JWT tokens attached to requests
- **Error handling** - Consistent error responses
- **Request/response interceptors** - Logging and retry logic
- **Type safety** - Full TypeScript support for API responses

```typescript
import { api } from '@/lib/api';

// Example usage
const strategies = await api.getStrategies();
const balance = await api.getCurrentBalance();
```

### WebSocket Integration

Real-time updates via Socket.IO client:

```typescript
import { useMarketStream } from '@/hooks/useMarketStream';

function PriceDisplay({ symbol }) {
  const { data, isConnected } = useMarketStream(symbol);

  return (
    <div>
      {isConnected ? '🟢' : '🔴'} {symbol}: ${data?.price}
    </div>
  );
}
```

### Data Fetching

TanStack Query for efficient data management:

```typescript
import { useQuery } from '@tanstack/react-query';

function StrategiesList() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['strategies'],
    queryFn: api.getStrategies,
    staleTime: 30000, // 30 seconds
  });

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      {data.map(strategy => (
        <StrategyCard key={strategy.id} strategy={strategy} />
      ))}
    </div>
  );
}
```

---

## Configuration

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `VITE_API_URL` | Backend API URL | ✅ | http://localhost:3000 |
| `VITE_NODE_ENV` | Environment | ❌ | development |

### Vite Configuration

**vite.config.ts** - Build optimization and development server:

```typescript
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          ui: ['@radix-ui/react-dialog', 'framer-motion'],
          charts: ['lightweight-charts', 'recharts'],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
```

### Tailwind CSS Configuration

**tailwind.config.js** - Custom design system:

```javascript
module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#3B82F6',
          secondary: '#10B981',
        },
      },
    },
  },
  plugins: [],
};
```

---

## Development Workflow

### Adding New Components

1. **Create component** in appropriate directory (`src/components/`)
2. **Use TypeScript** for props and state
3. **Follow naming conventions** (PascalCase for components)
4. **Add tests** in `__tests__/` directory
5. **Update exports** in `index.ts` if needed

### State Management

**Local Component State:**
```typescript
const [isLoading, setIsLoading] = useState(false);
```

**Global Application State:**
```typescript
import { useAuthStore } from '@/stores/authStore';

const { user, login, logout } = useAuthStore();
```

**Server State:**
```typescript
import { useQuery, useMutation } from '@tanstack/react-query';

const { data, error, isLoading } = useQuery({
  queryKey: ['strategies'],
  queryFn: api.getStrategies,
});
```

### Styling Guidelines

**Use Tailwind classes:**
```tsx
<button className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded">
  Click me
</button>
```

**Custom components with Tailwind:**
```tsx
function Button({ variant = 'primary', children, ...props }) {
  const baseClasses = "px-4 py-2 rounded font-medium transition-colors";
  const variantClasses = {
    primary: "bg-blue-500 hover:bg-blue-600 text-white",
    secondary: "bg-gray-200 hover:bg-gray-300 text-gray-800",
  };

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]}`}
      {...props}
    >
      {children}
    </button>
  );
}
```

---

## Testing

### Unit Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- Button.test.tsx

# Run with coverage
npm run test:coverage
```

### Test Structure

```
src/
├── components/
│   ├── Button.tsx
│   └── __tests__/
│       └── Button.test.tsx
├── hooks/
│   ├── useAuth.ts
│   └── __tests__/
│       └── useAuth.test.ts
```

### Example Test

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from './Button';

describe('Button', () => {
  it('renders children correctly', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('handles click events', () => {
    const handleClick = jest.fn();
    render(<Button onClick={handleClick}>Click me</Button>);

    fireEvent.click(screen.getByText('Click me'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
```

---

## Deployment

### Build Process

```bash
# Build for production
npm run build

# Files are generated in 'dist/' directory
# - index.html
# - assets/ (JS, CSS, images)
# - Optimized and minified
```

### Nginx Configuration

Serve the built files with nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    # SSL certificates
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;

    # Serve static files
    root /path/to/trade-bot/frontend/dist;
    index index.html;

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Handle React Router
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API requests
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Docker Deployment

```dockerfile
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

---

## Performance Optimization

### Bundle Analysis

```bash
# Analyze bundle size
npm run build -- --mode analyze

# Check bundle size
npx vite-bundle-analyzer dist/assets/*.js
```

### Code Splitting

- **Route-based splitting** - Pages load independently
- **Component lazy loading** - Heavy components load on demand
- **Vendor chunking** - Third-party libraries cached separately

### Image Optimization

- **Next-gen formats** - WebP, AVIF support
- **Responsive images** - Different sizes for different devices
- **Lazy loading** - Images load when needed

### Caching Strategy

- **Static assets**: 1-year cache with immutable headers
- **API responses**: Appropriate cache headers per endpoint
- **Service worker**: Offline functionality (future)

---

## Browser Support

- **Chrome**: 90+
- **Firefox**: 88+
- **Safari**: 14+
- **Edge**: 90+

---

## Contributing

1. Follow React and TypeScript best practices
2. Use functional components with hooks
3. Implement proper error boundaries
4. Add comprehensive tests
5. Follow the established component structure
6. Use Tailwind CSS for styling
7. Document new components and APIs

### Code Standards

- **React**: Functional components with hooks
- **TypeScript**: Strict mode, no `any` types
- **Styling**: Tailwind CSS utility classes
- **Testing**: Vitest with React Testing Library
- **Performance**: Lazy loading and code splitting
- **Accessibility**: ARIA labels and keyboard navigation

---

**Frontend Status**: ✅ Production Ready | **React Version**: 19.2 | **Build Tool**: Vite 7
