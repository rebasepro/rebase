import React, { useEffect, useState } from "react";
import type { EntityCustomViewParams } from "@rebasepro/types";
import { useStorageSource } from "@rebasepro/core";
import { Container, Markdown, Typography } from "@rebasepro/ui";

/**
 * This is a sample view used to render the content of a blog entry.
 * It is bound to the data that is modified in the form.
 *
 * Adapted from the original FireCMS example_pro BlogEntryPreview.
 * Uses useStorageSource().getSignedUrl() to resolve storage keys to
 * download URLs — the same pattern end-users should follow in their
 * own custom views and SDK integrations.
 */
export function BlogEntryPreview({ modifiedValues }: EntityCustomViewParams) {

    const storage = useStorageSource();
    const values = modifiedValues as Record<string, any> | undefined;

    const [headerUrl, setHeaderUrl] = useState<string | undefined>();
    useEffect(() => {
        if (values?.hero_image) {
            storage.getSignedUrl(values.hero_image)
                .then((res) => setHeaderUrl(res.url ?? undefined));
        }
    }, [storage, values?.hero_image]);

    return (
        <div>

            {headerUrl && <img
                alt={"Header"}
                style={{
                    width: "100%",
                    maxHeight: "300px",
                    objectFit: "cover"
                }}
                src={headerUrl}
            />}

            <Container className={"mb-16"}>

                <Container maxWidth={"3xl"}>
                    {values?.title && <Typography variant={"h3"} className="mt-16 mb-12 mx-12">
                        {values.title}
                    </Typography>}
                </Container>

                {values?.content && values.content
                    .filter((e: any) => !!e)
                    .map(
                        (entry: any, index: number) => {
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

    return <Container maxWidth={"3xl"}>
        <div className="mt-12 mb-12 px-12">
            <Markdown source={markdownText}/>
        </div>
    </Container>;
}

export function StorageImage({ storagePath }: {
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
        <div className="flex justify-center">
            <div className="m-4 p-8">
                {url
                    ? <img
                        alt={"Content"}
                        style={{
                            objectFit: "contain",
                            width: "100%",
                            height: "100%"
                        }}
                        src={url}/>
                    : <div className="w-[200px] h-[200px] bg-surface-200 dark:bg-surface-700 animate-pulse rounded"/>
                }
            </div>
        </div>
    );
}

function Quote({ quoteText }: {
    quoteText: string
}) {

    if (!quoteText)
        return <></>;

    return <Container maxWidth={"5xl"} className={"border-l-2 border-l-red-950 dark:border-l-red-100 my-8 italic"}>
        <Typography variant="h5">
            {quoteText}
        </Typography>
    </Container>;
}
