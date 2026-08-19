import { Plus, Settings, User, ArrowRightToLine, Music, CreditCard, Smile, Baby, UserRound, UserCheck } from "lucide-react";
import React, { useState } from "react";
import {
    BooleanSwitch,
    Button,
    Checkbox,
    Chip,
    DateTimeField,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FileUpload,
    IconButton,
    MultiSelect,
    MultiSelectItem,
    SearchBar,
    Select,
    SelectItem,
    Sheet,
    Skeleton,
    Tab,
    Tabs,
    Tooltip
} from "@rebasepro/ui";

export default function ClientUIComponentsTeaser() {

    const [tabValue, setTabValue] = useState("tab1");
    const [isDialogOpen, setDialogOpen] = useState(false);
    const [isSheetOpen, setSheetOpen] = useState(false);
    const [checked, setChecked] = useState(true);
    const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
    const [selectedValue, setSelectedValue] = useState<string>();
    const [multiSelectedValue, setMultiSelectedValue] = useState<string[]>();
    const cardClasses = "relative p-4 flex flex-col gap-2 break-inside-avoid dark:bg-surface-950 mb-4 rounded-lg";

    return (
        <div className={"@container max-w-6xl mx-auto not-content my-8"}>
            <div className="@xl:columns-2 @4xl:columns-3 gap-4">

                <div className={cardClasses + " flex-row"}>
                    <Button>Buttons</Button>
                    <Button variant={"text"}>Buttons</Button>
                </div>

                <div className={cardClasses}>
                    <Tabs value={tabValue} onValueChange={setTabValue}>
                        <Tab value="tab1">Tab 1</Tab>
                        <Tab value="tab2">Tab 2</Tab>
                        <Tab value="tab3">Tab 3</Tab>
                    </Tabs>
                </div>

                <div className={cardClasses}>
                    <FileUpload accept={{ "image/*": [] }} title="Click or drop your image" onFilesAdded={() => {
                        console.log("Files added");
                    }}/>
                </div>

                <div className={cardClasses}>
                    <Select
                        className={"w-full"}
                        value={selectedValue}
                        onValueChange={setSelectedValue}
                        placeholder={<i>Select a Simpsons character</i>}
                        renderValue={(value) => {
                            if (value === "homer") {
                                return "Homer";
                            } else if (value === "marge") {
                                return "Marge";
                            } else if (value === "bart") {
                                return "Bart";
                            } else if (value === "lisa") {
                                return "Lisa";
                            }
                            throw new Error("Invalid value");
                        }}
                    >
                        <SelectItem value="homer">Homer</SelectItem>
                        <SelectItem value="marge">Marge</SelectItem>
                        <SelectItem value="bart">Bart</SelectItem>
                        <SelectItem value="lisa">Lisa</SelectItem>
                    </Select>
                </div>

                <div className={cardClasses}>
                    <SearchBar innerClassName="w-full"/>
                </div>

                <div className={cardClasses + " flex-row"}>
                    <Button color="neutral" size="small" onClick={() => setDialogOpen(true)}>Open Dialog</Button>
                    <Button color="neutral" size="small" onClick={() => setSheetOpen(true)}>Open side
                        sheet
                        <ArrowRightToLine size={16}/>
                    </Button>
                    <Dialog open={isDialogOpen} onOpenChange={setDialogOpen}>

                        <DialogTitle variant={"h6"} gutterBottom>
                            Dialog
                        </DialogTitle>
                        <DialogContent>
                            This UI kit is amazing!
                        </DialogContent>
                        <DialogActions>
                            <Button
                                color="primary"
                                onClick={() => setDialogOpen(false)}>
                                Ok
                            </Button>
                        </DialogActions>
                    </Dialog>
                    <Sheet open={isSheetOpen} onOpenChange={setSheetOpen}>
                        <div className="bg-white font-semibold dark:bg-surface-800 p-4 h-full">
                            Sheet Content
                        </div>
                    </Sheet>
                </div>


                <div className={cardClasses + " flex-row items-center"}>
                    <Tooltip title={"Small button"}>
                        <IconButton variant="filled" size="small" onClick={() => console.log("Small Clicked!")}>
                            <Settings size={16}/>
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={"Ghost button"}>
                        <IconButton variant="ghost" onClick={() => console.log("Clicked!")}>
                            <Music/>
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={"Filled button"}>
                        <IconButton
                            variant="filled"
                            onClick={() => console.log("Square Clicked!")}>
                            <Plus/>
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={"Square filled button"}>
                        <IconButton
                            variant="filled"
                            shape="square"
                            onClick={() => console.log("Square Clicked!")}>
                            <CreditCard/>
                        </IconButton>
                    </Tooltip>
                </div>

                <div className={cardClasses}>
                    <DateTimeField value={selectedDate}
                        onChange={(d) => setSelectedDate(d ?? undefined)}
                        label="Select a date"
                        mode="date"/>
                </div>

                <div className={cardClasses + " flex-row items-center"}>
                    <Checkbox checked={checked} onCheckedChange={() => setChecked(!checked)} size="medium"/>
                    <BooleanSwitch size="small" value={checked} onValueChange={() => setChecked(!checked)}/>
                </div>

                <div className={cardClasses}>
                    <MultiSelect
                        className={"w-full"}
                        value={multiSelectedValue}
                        onValueChange={setMultiSelectedValue}
                        placeholder={<i>Multi select</i>}
                    >
                        <MultiSelectItem value="mother"><UserRound/>Mother</MultiSelectItem>
                        <MultiSelectItem value="father"><User/>Father</MultiSelectItem>
                        <MultiSelectItem value="kid"><UserCheck/>Kid</MultiSelectItem>
                        <MultiSelectItem value="baby"><Baby/>Baby</MultiSelectItem>
                    </MultiSelect>
                </div>

                <div className={cardClasses}>
                    <Skeleton width={180} height={20}/>
                    <Skeleton width={2000} height={16}/>
                    <Skeleton width={120} height={16}/>
                </div>

                <div className={cardClasses}>
                    <Chip colorScheme={"yellowLight"}><Smile size={16}/>John Peterson</Chip>
                </div>

            </div>
            <div className="text-center">
                <a
                    className={"inline-flex items-center justify-center gap-x-2 rounded-lg text-primary px-6 py-3 text-base font-semibold  hover:text-primary-dark transition-all duration-200 ease-in-out btn-glow w-full lg:w-auto mt-8"}
                    href={"/ui"}
                >
                    See all components
                </a>
            </div>
        </div>
    );
};
