/** @format */

import React from "react";
import { useAuth } from "../../auth/hooks";
import {
  ConnectExchangeAccount,
  ExchangeAccounts,
  ConnectedWallets,
} from "../components";
import { accountsApi } from "../../../infrastructure/api/accounts";
import { Shield } from "lucide-react";
import { Card } from "../../../shared/components/ui";
import { SectionHeader } from "../../../shared/components/ui";
import { MetricIcon } from "../../../shared/components/ui";
import {
  Container,
  ElectricalNetworkBackground,
  Grid,
} from "../../../shared/components/layout";
import { useQuery } from "@tanstack/react-query";

/**
 * Settings (C2) - exchange accounts and multi-wallets live behind generic
 * venue/environment and multi-chain flows.
 */
const Settings: React.FC = () => {
  const { user } = useAuth();

  const accountsQuery = useQuery({
    queryKey: ["exchange-accounts", user?.id],
    queryFn: () => accountsApi.listAccounts(),
    enabled: !!user,
    staleTime: 30 * 1000,
  });
  const accounts = accountsQuery.data?.data?.accounts ?? [];

  return (
    <Container>
      <ElectricalNetworkBackground />
      <Grid>
        <ConnectedWallets />

        <ConnectExchangeAccount accounts={accounts} />

        <ExchangeAccounts />

        {/* Security Notice */}
        <Card>
          <SectionHeader
            title="Security Information"
            actions={<MetricIcon icon={Shield} color="warning" />}
          />
          <div className="space-y-3 text-sm text-textMuted">
            <p>
              • Your exchange API credentials are encrypted using AES-256
              encryption before storage
            </p>
            <p>
              • Credentials are only decrypted in memory when needed for API
              calls
            </p>
            <p>• All credential operations are logged for security auditing</p>
            <p>• You can disconnect your credentials at any time</p>
          </div>
        </Card>
      </Grid>
    </Container>
  );
};

export default Settings;
