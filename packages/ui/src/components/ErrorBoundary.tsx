
import React, { ErrorInfo, PropsWithChildren } from "react";

import { AlertCircleIcon } from "lucide-react";
import { iconSize } from "../icons/Icon";
import { Typography } from "./Typography";

export class ErrorBoundary extends React.Component<PropsWithChildren<Record<string, unknown>>, {
    error: Error | null
}> {
    constructor(props: any) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error: Error) {
        return { error };
    }

    componentDidCatch(error: Error, _errorInfo: ErrorInfo) {
        console.error(error);
        // logErrorToMyService(error, errorInfo);
    }

    render() {
        if (this.state.error) {
            return (
                <div className="flex flex-col m-2">
                    <div className="flex items-center m-2">
                        <AlertCircleIcon className={"text-red-500"} size={iconSize.small}/>
                        <div className="ml-4">Error</div>
                    </div>
                    <Typography variant={"caption"}>
                        {this.state.error?.message ?? "See the error in the console"}
                    </Typography>
                </div>
            );
        }

        return this.props.children;
    }
}
