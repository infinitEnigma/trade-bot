#!/bin/bash

# Phase 4 Verification Script
# Run this after starting the backend to verify fixes

echo "🔍 Phase 4 Fixes - Verification Script"
echo "======================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: Backend health check
echo -e "${YELLOW}[1/5]${NC} Checking backend health..."
HEALTH=$(curl -s http://localhost:3000/health)
if echo "$HEALTH" | grep -q '"status":"ok"'; then
  echo -e "${GREEN}✅ Backend is running${NC}"
else
  echo -e "${RED}❌ Backend health check failed${NC}"
  echo "Response: $HEALTH"
fi
echo ""

# Test 2: Check klines endpoint (empty is OK at first)
echo -e "${YELLOW}[2/5]${NC} Testing /api/market/klines endpoint..."
KLINES=$(curl -s "http://localhost:3000/api/market/klines?symbol=PERP_BTC_USDC&interval=1h")
if echo "$KLINES" | grep -q '"success":true'; then
  DATACOUNT=$(echo "$KLINES" | grep -o '"data":\[' | wc -l)
  if echo "$KLINES" | grep -q '"data":\[\]'; then
    echo -e "${YELLOW}⏳ Klines endpoint OK (no data yet - WebSocket still connecting)${NC}"
  else
    CANDLES=$(echo "$KLINES" | grep -o '"time":' | wc -l)
    echo -e "${GREEN}✅ Klines endpoint OK (${CANDLES} candles in cache)${NC}"
  fi
else
  echo -e "${RED}❌ Klines endpoint failed${NC}"
  echo "Response: $KLINES"
fi
echo ""

# Test 3: Check Redis for kline cache
echo -e "${YELLOW}[3/5]${NC} Checking Redis for kline cache..."
if command -v redis-cli &> /dev/null; then
  KEYS=$(redis-cli keys "kline:*" 2>/dev/null | wc -l)
  if [ "$KEYS" -gt 0 ]; then
    echo -e "${GREEN}✅ Redis has kline data (${KEYS} cached intervals)${NC}"
    # Show first key details
    FIRST_KEY=$(redis-cli keys "kline:*" 2>/dev/null | head -1)
    if [ -n "$FIRST_KEY" ]; then
      echo "   Sample: $FIRST_KEY"
      CANDLE_COUNT=$(redis-cli get "$FIRST_KEY" 2>/dev/null | grep -o '"time":' | wc -l)
      echo "   Contains: ${CANDLE_COUNT} candles"
    fi
  else
    echo -e "${YELLOW}⏳ Redis cache empty (WebSocket still collecting data)${NC}"
  fi
else
  echo -e "${YELLOW}⚠️  redis-cli not installed, skipping Redis check${NC}"
fi
echo ""

# Test 4: Check backend logs for WebSocket connection
echo -e "${YELLOW}[4/5]${NC} Checking backend logs for WebSocket connection..."
if [ -f "backend/logs/combined.log" ]; then
  if grep -q "Orderly market WebSocket connected successfully" backend/logs/combined.log; then
    echo -e "${GREEN}✅ WebSocket connected successfully${NC}"
  elif grep -q "Market WebSocket error\|Market WebSocket closed" backend/logs/combined.log; then
    echo -e "${RED}❌ WebSocket connection errors detected${NC}"
    echo "Recent errors:"
    grep "Market WebSocket error\|Market WebSocket closed" backend/logs/combined.log | tail -3
  else
    echo -e "${YELLOW}⏳ No WebSocket messages yet (check if backend is fully started)${NC}"
  fi
else
  echo -e "${YELLOW}⚠️  Log file not found, skipping log check${NC}"
fi
echo ""

# Test 5: Summary
echo -e "${YELLOW}[5/5]${NC} Summary"
echo "======================================"
echo "If you see:"
echo "  - ✅ Backend is running"
echo "  - ✅ Klines endpoint OK (with candles)"
echo "  - ✅ Redis has kline data"
echo "  - ✅ WebSocket connected successfully"
echo ""
echo "Then the fixes are working! 🎉"
echo ""
echo "Next steps:"
echo "  1. Start frontend: npm run dev (in frontend folder)"
echo "  2. Go to Strategies page"
echo "  3. Chart should load with candlesticks"
echo ""
echo "Troubleshooting:"
echo "  - If no kline data: Wait 5-10 seconds, WebSocket may still be connecting"
echo "  - If WebSocket error: Check logs for connection details"
echo "  - If API fails: Verify backend is running on port 3000"
echo "  - Check logs: tail -f backend/logs/error.log"
echo ""
