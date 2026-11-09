/**
 * A `PostgresBackendDriver` with nothing behind it: a recording database, a
 * real realtime service whose `notifyUpdate` is stubbed, and — when asked — a
 * real history service whose `recordHistory` is a spy. For tests that drive
 * the driver's write pipeline with `dataService` stubbed underneath it.
 */
import { jest } from "@jest/globals";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry";
import { HistoryService } from "../../src/history/HistoryService";
import { RealtimeService } from "../../src/services/realtimeService";
import { recordingDb } from "./spg-b-recording-db";

export function driverStand(registry = new PostgresCollectionRegistry()) {
    const recording = recordingDb();
    const realtime = new RealtimeService(recording.db, registry);
    const notifyUpdate = jest.spyOn(realtime, "notifyUpdate").mockResolvedValue(undefined);
    const history = new HistoryService(recording.db);
    const recordHistory = jest.spyOn(history, "recordHistory").mockResolvedValue(undefined);
    jest.spyOn(history, "assertRecordable").mockImplementation(() => undefined);
    const driver = new PostgresBackendDriver(recording.db, realtime, registry, undefined, undefined, history);
    return { driver, realtime, history, notifyUpdate, recordHistory, recording };
}
