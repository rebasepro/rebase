import { useCallback, useState } from "react";
import { useDataki } from "../../DatakiProvider";
import { listDbConnections } from "../../api";
import { DatabaseConnectionConfig } from "../../types";

export function useTeamDBConnections(teamId:string) {
    const {
        getDatakiAuthToken,
        apiEndpoint
    } = useDataki();

    const [connections, setConnections] = useState<DatabaseConnectionConfig[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingConnectionsError, setLoadingConnectionsError] = useState<Error | null>(null);
    const loadConnections = useCallback(async () => {
        setLoading(true);
        setLoadingConnectionsError(null);
        try {
            const token = await getDatakiAuthToken();
            const data = await listDbConnections(teamId, token, apiEndpoint);
            console.log("Loaded connections:", data);
            setConnections(data);
        } catch (error: any) {
            setLoadingConnectionsError(error);
            console.error("Error loading connections:", error);
        } finally {
            setLoading(false);
        }
    }, [teamId, getDatakiAuthToken, apiEndpoint]);

    return {
        connections,
        loading,
        loadConnections
    };
}
