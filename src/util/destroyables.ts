import Sortable from "sortablejs";
import { ErrorPF2e } from "./misc.ts";

class DestroyableManager {
    #appObservers = new Map<Node, MutationObserverContext>();

    declare static instance: DestroyableManager;

    static #OBSERVE_OPTIONS = {
        attributes: false,
        characterData: false,
        childList: true,
        subtree: false,
    };

    /** Start observing the document body. */
    static initialize(): void {
        DestroyableManager.instance ??= new DestroyableManager();
    }

    constructor() {}

    observe(destroyable: Destroyable): void {
        const destroyableEl =
            destroyable instanceof Sortable
                ? destroyable.el
                : destroyable instanceof TooltipsterTarget
                  ? destroyable.element
                  : destroyable.DOM.input;
        const contentEl = destroyableEl?.closest(".app, .application")?.querySelector(".window-content");
        if (!contentEl && !destroyableEl.closest(".chat-message"))
            return console.warn(ErrorPF2e("No application element found").message);
        if (!contentEl) return;

        let context = this.#appObservers.get(contentEl);
        if (context) {
            context.elements.push(destroyableEl, contentEl);
            context.destroyables.push(destroyable);
            return;
        }

        context = {
            observer: null,
            contextKey: contentEl,
            elements: [destroyableEl],
            destroyables: [destroyable],
        };
        const observer = new MutationObserver(this.#onMutate(context));
        context.observer = observer;

        this.#appObservers.set(contentEl, context);

        observer.observe(contentEl, DestroyableManager.#OBSERVE_OPTIONS);
        observer.observe(document.body, DestroyableManager.#OBSERVE_OPTIONS);
    }

    #onMutate(context: MutationObserverContext): (mutations: MutationRecord[]) => void {
        return (mutations: MutationRecord[]) => {
            for (const mutation of mutations) {
                for (const element of mutation.removedNodes) {
                    if (!context.elements.some((contextElement) => element.contains(contextElement))) {
                        continue;
                    }
                    for (const destroyable of context.destroyables) {
                        destroyable.destroy();
                    }
                    if (context.observer) {
                        context.observer.disconnect();
                    }
                    this.#appObservers.delete(context.contextKey);
                    context.observer = null;
                    context.destroyables = [];
                    context.elements = [];
                }
            }
        };
    }
}

interface MutationObserverContext {
    observer: MutationObserver | null;
    contextKey: Node;
    elements: Node[];
    destroyables: Destroyable[];
}

type Destroyable = Tagify<{ id: string; value: string }> | Tagify<Tagify.TagData> | Sortable | TooltipsterTarget;

class TooltipsterTarget {
    $element: JQuery;
    instance: Destroyable;

    constructor($element: JQuery, instance: Destroyable) {
        this.$element = $element;
        this.instance = instance;
    }

    get element(): HTMLElement {
        return this.$element[0];
    }

    destroy(): void {
        this.instance.destroy();
    }
}

function createSortable(list: HTMLElement, options: Sortable.Options): Sortable {
    const sortable = new Sortable(list, options);
    DestroyableManager.instance.observe(sortable);
    return sortable;
}

function createTooltipster(target: HTMLElement, options: JQueryTooltipster.ITooltipsterOptions): JQuery {
    const $element = $(target);
    const $tooltipsterEl = $element.tooltipster(options);
    // get tooltipster namespace key
    const tooltipsterNs: string | undefined = $tooltipsterEl.data("tooltipster-ns")?.[0];
    if (!tooltipsterNs) {
        console.warn(ErrorPF2e("No tooltipster namespace found").message);
        return $tooltipsterEl;
    }
    // get internal tooltipster instance
    const tooltipsterInstance: Destroyable | undefined = $tooltipsterEl.data(tooltipsterNs);
    if (!tooltipsterInstance) {
        console.warn(ErrorPF2e("No tooltipster instance found").message);
        return $tooltipsterEl;
    }
    // create wrapper of instance and tooltipster element for cleanup after element has been removed from DOM
    DestroyableManager.instance.observe(new TooltipsterTarget($tooltipsterEl, tooltipsterInstance));
    return $tooltipsterEl;
}

export { DestroyableManager, createSortable, createTooltipster };
