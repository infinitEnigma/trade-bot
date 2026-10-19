import { query } from "../../src/database/pool";
import { LedgerIntegrityAlertRepository } from "../../src/infrastructure/adapters/repositories/ledger-integrity-alert-repository.adapter";

jest.mock("../../src/database/pool", () => ({
  query: jest.fn(),
}));

const mockedQuery = query as jest.MockedFunction<typeof query>;

describe("LedgerIntegrityAlertRepository", () => {
  const repository = new LedgerIntegrityAlertRepository();
  const alert = {
    botId: "not-a-real-bot-id",
    eventType: "TRADE_EXECUTED",
    messageId: "1710000000000-0",
    correlationId: "corr-1",
    deliveries: 10,
    reason: "financial-event-poison-threshold",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("persists an alert without requiring a bot foreign key", async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ inserted: true }],
      rowCount: 1,
    } as never);

    await expect(repository.record(alert)).resolves.toBe(true);

    const [sql, values] = mockedQuery.mock.calls[0];
    expect(sql).toContain("INSERT INTO ledger_integrity_alerts");
    expect(sql).toContain("ON CONFLICT (event_type, message_id) DO UPDATE");
    expect(values).toEqual([
      alert.botId,
      alert.eventType,
      alert.messageId,
      alert.correlationId,
      alert.deliveries,
      alert.reason,
    ]);
  });

  it("updates the existing alert on redelivery without creating a duplicate", async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ inserted: false }],
      rowCount: 1,
    } as never);

    await expect(repository.record(alert)).resolves.toBe(false);
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });

  it("propagates persistence errors so the event remains pending", async () => {
    mockedQuery.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(repository.record(alert)).rejects.toThrow(
      "database unavailable"
    );
  });
});
