
import React, { useEffect, useState } from "react";
import type { EntityCustomViewParams } from "@rebasepro/cms-types";
import { useStorageSource } from "@rebasepro/app";
import { Container, Markdown, Typography } from "@rebasepro/ui";

/**
 * This is a sample view used to render the content of a blog entry.
 * It is bound to the data that is modified in the form.
 *
 * Custom view for rendering blog entry content with live preview.
 * Uses useStorageSource().getSignedUrl() to resolve storage keys to
 * download URLs — the same pattern end-users should follow in their
 * own custom views and SDK integrations.
 */
export function BlogEntryPreview({ modifiedValues }: EntityCustomViewParams) {

    const storage = useStorageSource();
    const values = modifiedValues as Record<string, unknown> | undefined;
    const title = values?.title as string | undefined;
    const content = values?.content as Array<{ type: string; value: string } | null> | undefined;

    const [headerUrl, setHeaderUrl] = useState<string | undefined>();
    useEffect(() => {
        const heroImage = values?.hero_image;
        if (typeof heroImage === "string") {
            storage.getSignedUrl(heroImage)
                .then((res) => setHeaderUrl(res.url ?? undefined));
        }
    }, [storage, values?.hero_image]);

    return (
        <div className="h-full overflow-y-auto">

            {headerUrl && <div className="px-6 pt-6">
                <img
                    alt={"Header"}
                    className="w-full max-h-[400px] object-cover rounded-xl"
                    src={headerUrl}
                />
            </div>}

            <Container className={"mb-16"}>

                <Container maxWidth={"6xl"}>
                    {title && <Typography variant={"h3"} className="mt-10 mb-8 mx-6">
                        {title}
                    </Typography>}
                </Container>

                {content && Array.isArray(content) && content
                    .filter((e): e is { type: string; value: string } => !!e)
                    .map(
                        (entry, index) => {
                            if (entry.type === "text")
                                return <Text key={`preview_text_${index}`}
                                             markdownText={entry.value}/>;
                            if (entry.type === "quote")
                                return <Quote key={`preview_text_${index}`}
                                              quoteText={entry.value}/>;
                            if (entry.type === "image")
                                return <StorageImage key={`preview_image_${index}`}
                                                     storagePath={entry.value}/>;
                            return null;
                        }
                    )}

            </Container>

        </div>
    );

}

function Text({ markdownText }: {
    markdownText: string
}) {

    if (!markdownText)
        return <></>;

    return <Container maxWidth={"6xl"}>
        <div className="mt-6 mb-6 px-6">
            <Markdown source={markdownText}/>
        </div>
    </Container>;
}

function StorageImage({ storagePath }: {
    storagePath: string
}) {

    const storage = useStorageSource();
    const [url, setUrl] = useState<string | undefined>();
    useEffect(() => {
        if (storagePath) {
            storage.getSignedUrl(storagePath)
                .then((res) => setUrl(res.url ?? undefined));
        }
    }, [storage, storagePath]);

    if (!storagePath)
        return <></>;

    return (
        <Container maxWidth={"6xl"}>
            <div className="my-6 px-6">
                {url
                    ? <img
                        alt={"Content"}
                        className="w-full h-auto rounded-xl object-cover"
                        src={url}/>
                    : <div className="w-full h-[240px] bg-surface-200 dark:bg-surface-700 animate-pulse rounded-xl"/>
                }
            </div>
        </Container>
    );
}

function Quote({ quoteText }: {
    quoteText: string
}) {

    if (!quoteText)
        return <></>;

    return <Container maxWidth={"6xl"} className={"border-l-2 border-l-red-950 dark:border-l-red-100 my-6 mx-6 px-6 italic"}>
        <Typography variant="h5">
            {quoteText}
        </Typography>
    </Container>;
}
