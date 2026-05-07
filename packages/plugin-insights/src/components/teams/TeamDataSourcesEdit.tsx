import { Team } from "../../types";
import { TeamGCPProjects } from "./TeamGCPProjects";
import { TeamDbConnections } from "./TeamDbConnections";
import { TeamSheets } from "./TeamSheets";
import TeamFilesSection from "./TeamFilesSection";

interface TeamDatasourcesProps {
    team: Team;
    onAnalyticsEvent: (event: string, params?: any) => void;
}

export function TeamDataSourcesEdit({
                                        team,
                                        onAnalyticsEvent
                                    }: TeamDatasourcesProps) {

    return (
        <>
            <TeamDbConnections team={team} onAnalyticsEvent={onAnalyticsEvent}/>
            <TeamFilesSection teamId={team.id} onAnalyticsEvent={onAnalyticsEvent}/>
            <TeamGCPProjects team={team} onAnalyticsEvent={onAnalyticsEvent}/>
            <TeamSheets team={team} onAnalyticsEvent={onAnalyticsEvent}/>
        </>
    );

}
