import type { ActorPF2e } from "@actor";
import { Immunity, IWRSource, Resistance, Weakness } from "@actor/data/iwr.ts";
import { ImmunityType, IWRType, ResistanceType, WeaknessType } from "@actor/types.ts";
import { ErrorPF2e, htmlClosest, htmlQuery, htmlQueryAll, tagify } from "@util";
import * as R from "remeda";

class IWREditor<TActor extends ActorPF2e> extends DocumentSheet<TActor, IWREditorOptions> {
    category: ListCategory;

    types: Record<string, string>;

    /** Active tagify instances. Have to be cleaned up to avoid memory leaks */
    #tagifyInstances: Tagify<Record<"id" | "value", string>>[] = [];

    constructor(actor: TActor, options: IWREditorConstructorOptions) {
        super(actor, options);

        if (this.actor.isOfType("familiar", "loot")) {
            throw ErrorPF2e(`Actor ${this.actor.name} (${this.actor.uuid}) may not have stored IWR data`);
        }
        this.category = options.category;
        this.types = {
            immunities: R.omit(CONFIG.PF2E.immunityTypes, ["custom"]),
            weaknesses: R.omit(CONFIG.PF2E.weaknessTypes, ["custom"]),
            resistances: R.omit(CONFIG.PF2E.resistanceTypes, ["custom"]),
        }[this.category];
    }

    static override get defaultOptions(): DocumentSheetOptions {
        return {
            ...super.defaultOptions,
            closeOnSubmit: false,
            classes: ["iwr-editor"],
            template: "systems/pf2e/templates/actors/iwr-editor.hbs",
            sheetConfig: false,
            width: 500,
            height: "auto",
        };
    }

    override get id(): string {
        return `${this.category}-editor-${this.actor.uuid}`;
    }

    override get title(): string {
        return game.i18n.format("PF2E.Actor.IWREditor.Title", {
            actor: this.actor.name,
            category: game.i18n.localize(this.categoryLabel),
        });
    }

    get actor(): TActor {
        return this.document;
    }

    get categoryLabel(): string {
        return {
            immunities: "PF2E.ImmunitiesLabel",
            weaknesses: "PF2E.WeaknessesLabel",
            resistances: "PF2E.ResistancesLabel",
        }[this.category];
    }

    override async getData(options: Partial<IWREditorOptions> = {}): Promise<IWREditorData<TActor>> {
        this.options.id = this.id;

        return {
            ...(await super.getData(options)),
            category: this.category,
            header: this.categoryLabel,
            list: this.actor.attributes[this.category],
            sourceData: this.actor._source.system.attributes?.[this.category] ?? [],
            types: this.types,
        };
    }

    /** Reconstruct the entire IWR array from form inputs */
    getUpdatedData({ includeNew = false } = {}): ProbablyIWRData[] {
        const entryElems = htmlQueryAll(this.element[0], ".entry:not(.new,[data-synthetic])");
        if (includeNew) {
            entryElems.push(...htmlQueryAll(this.element[0], ".entry.new"));
        }

        return entryElems.flatMap((entryElem): ProbablyIWRData | never[] => {
            const iwrType = htmlQuery(entryElem, "select")?.value;
            if (!iwrType) return [];
            const value =
                Math.trunc(
                    Math.abs(
                        Number(htmlQuery<HTMLInputElement>(entryElem, "input[data-property=value]")?.value ?? "NaN"),
                    ),
                ) || 5;

            const exceptionsData: unknown = JSON.parse(
                htmlQuery<HTMLInputElement>(entryElem, "input[data-property=exceptions]")?.value || "[]",
            );
            if (
                !(
                    Array.isArray(exceptionsData) &&
                    exceptionsData.every((o: unknown): o is { id: string } => R.isPlainObject(o))
                )
            ) {
                throw ErrorPF2e("Unexpected data encountered while submitting form");
            }
            const exceptions = exceptionsData.map((e: { id: string }) => e.id);

            const doubleVsData: unknown = JSON.parse(
                htmlQuery<HTMLInputElement>(entryElem, "input[data-property=doubleVs]")?.value || "[]",
            );
            const doubleVsIsValid =
                Array.isArray(doubleVsData) &&
                doubleVsData.every(
                    (o: unknown): o is { id: string } =>
                        R.isPlainObject(o) && typeof o.id === "string" && o.id in this.types,
                );
            const doubleVs =
                doubleVsIsValid && this.category === "resistances" ? doubleVsData.map((d) => d.id) : undefined;

            if (exceptions.every((e): e is IWRType => typeof e === "string")) {
                return {
                    type: iwrType,
                    value: this.category === "immunities" ? undefined : value || 1,
                    exceptions,
                    doubleVs,
                };
            }
            return [];
        });
    }

    async #updateIWR({ includeNew = false } = {}): Promise<void> {
        const data = this.getUpdatedData({ includeNew });
        // The lone named input element that contains the full form data
        const formInput = htmlQuery<HTMLInputElement>(this.element[0], "input[name]");
        if (!formInput) throw ErrorPF2e("Unexpected error getting for input element");

        formInput.value = JSON.stringify(data);
        await this.submit({ preventRender: false });
    }

    /* -------------------------------------------- */
    /*  Event Handlers                              */
    /* -------------------------------------------- */

    /** Exclude sheet selection and compendium import */
    protected override _getHeaderButtons(): ApplicationHeaderButton[] {
        return super._getHeaderButtons().filter((b) => b.class === "close");
    }

    override activateListeners($html: JQuery): void {
        this._resetListeners();
        const html = $html[0];

        for (const input of htmlQueryAll<HTMLInputElement>(html, "input[type=text]")) {
            this.#tagifyInstances.push(tagify(input, { whitelist: this.types, maxTags: 6 }));
        }

        htmlQuery(html, "a[data-action=add]")?.addEventListener("click", (event) => {
            const entryElem = htmlClosest(event.target, ".entry.new");
            const typeElem = htmlQuery<HTMLSelectElement>(entryElem, "select[data-property=type]");
            if (typeElem?.value) {
                this.#updateIWR({ includeNew: true });
            }
        });

        // Change existing IWR entry's type, value, exceptions, or doubleVs
        for (const inputOrSelect of htmlQueryAll(html, "select, input")) {
            const entryElem = htmlClosest(inputOrSelect, ".entry");
            if (entryElem && !entryElem.classList.contains("new")) {
                inputOrSelect.addEventListener("change", () => {
                    this.#updateIWR();
                });
            }
        }

        // Remove an existing IWR entry
        for (const removeButton of htmlQueryAll(html, "a[data-action=remove]")) {
            removeButton.addEventListener("click", async (event) => {
                const entryElem = htmlClosest(event.target, ".entry");
                entryElem?.remove();
                this.#updateIWR();
            });
        }
    }

    _resetListeners(): void {
        this.#tagifyInstances.forEach((tagified) => tagified.destroy());
        this.#tagifyInstances = [];
    }

    override async close(options?: { force?: boolean | undefined }): Promise<void> {
        this._resetListeners();
        return super.close(options);
    }
}

interface IWREditorOptions extends DocumentSheetOptions {
    category: ListCategory;
}

interface IWREditorConstructorOptions extends Partial<DocumentSheetOptions> {
    category: ListCategory;
}

interface IWREditorData<TActor extends ActorPF2e> extends DocumentSheetData<TActor> {
    header: string;
    category: ListCategory;
    list: Immunity[] | Weakness[] | Resistance[];
    sourceData: IWRSource<ImmunityType | WeaknessType | ResistanceType>[];
    types: Record<string, string>;
}

type ListCategory = "immunities" | "weaknesses" | "resistances";

interface ProbablyIWRData {
    type: string;
    exceptions: string[];
    value?: number;
    doubleVs?: string[];
}

export { IWREditor };
