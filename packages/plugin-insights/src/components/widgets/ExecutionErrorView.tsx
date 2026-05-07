export function ExecutionErrorView(props: { executionError: Error }) {
    const message = props.executionError.message;
    const urlRegex = /https?:\/\/[^\s]+/g;
    const htmlContent = message.replace(urlRegex, (url) => {
        // For each URL found, replace it with an HTML <a> tag
        return `<a href="${url}" target="_blank" class="underline">LINK</a><br/>`;
    });

    return <div className={"p-4 w-full"}>
        <div className={"w-full text-sm bg-red-100 dark:bg-red-800 p-4 rounded-lg"}>
            <code className={"text-red-700 dark:text-red-300 break-all"}
                  dangerouslySetInnerHTML={{ __html: htmlContent }}/>
        </div>
    </div>;
}
