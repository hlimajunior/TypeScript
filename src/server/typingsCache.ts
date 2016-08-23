/// <reference path="project.ts"/>

namespace ts.server {
    export interface ITypingsInstaller {
        enqueueInstallTypingsRequest(p: Project, typingOptions: TypingOptions): void;
        attach(projectService: ProjectService): void;
        onProjectClosed(p: Project): void;
    }

    export const nullTypingsInstaller: ITypingsInstaller = {
        enqueueInstallTypingsRequest: () => {},
        attach: (projectService: ProjectService) => {},
        onProjectClosed: (p: Project) => {}
    };

    class TypingsCacheEntry {
        readonly typingOptions: TypingOptions;
        readonly compilerOptions: CompilerOptions;
        readonly typings: TypingsArray;
        readonly files: string[];
        poisoned: boolean;
    }

    const emptyArray: any[] = [];
    const jsOrDts = [".js", ".d.ts"];

    function getTypingOptionsForProjects(proj: Project): TypingOptions {
        if (proj.projectKind === ProjectKind.Configured) {
            return (<ConfiguredProject>proj).getTypingOptions();
        }

        const enableAutoDiscovery = proj.getFileNames().every(f => fileExtensionIsAny(f, jsOrDts));

        // TODO: add .d.ts files to excludes 
        return { enableAutoDiscovery, include: emptyArray, exclude: emptyArray };
    }

    function setIsEqualTo(arr1: string[], arr2: string[]): boolean {
        if (arr1 === arr2) {
            return true;
        }
        if ((arr1 || emptyArray).length === 0 && (arr2 || emptyArray).length === 0) {
            return true;
        }
        const set: Map<boolean> = createMap<boolean>();
        let unique = 0;

        for (const v of arr1) {
            if (set[v] !== true) {
                set[v] = true;
                unique++;
            }
        }
        for (const v of arr2) {
            if (!hasProperty(set, v)) {
                return false;
            }
            if (set[v] === true) {
                set[v] = false;
                unique--;
            }
        }
        return unique === 0;
    }

    function typingOptionsChanged(opt1: TypingOptions, opt2: TypingOptions): boolean {
        return opt1.enableAutoDiscovery !== opt2.enableAutoDiscovery ||
            !setIsEqualTo(opt1.include, opt2.include) ||
            !setIsEqualTo(opt1.exclude, opt2.exclude);
    }

    function compilerOptionsChanged(opt1: CompilerOptions, opt2: CompilerOptions): boolean {
        // TODO: add more relevant properties
        return opt1.allowJs != opt2.allowJs;
    }

    function filesChanged(before: string[], after: string[]): boolean {
        return !setIsEqualTo(before, after);
    }

    export interface TypingsArray extends ReadonlyArray<string> {
        " __typingsArrayBrand": any;
    }

    function toTypingsArray(arr: string[]): TypingsArray {
        arr.sort();
        return <any>arr;
    }

    export class TypingsCache {
        private readonly perProjectCache: Map<TypingsCacheEntry> = createMap<TypingsCacheEntry>();

        constructor(private readonly installer: ITypingsInstaller) {
        }

        getTypingsForProject(project: Project): TypingsArray {
            const typingOptions = getTypingOptionsForProjects(project);

            if (!typingOptions.enableAutoDiscovery) {
                return <any>emptyArray;
            }

            const entry = this.perProjectCache[project.getProjectName()];
            const result: TypingsArray = entry ? entry.typings : <any>emptyArray;
            if (!entry || typingOptionsChanged(typingOptions, entry.typingOptions) || compilerOptionsChanged(project.getCompilerOptions(), entry.compilerOptions) || filesChanged(project.getFileNames(), entry.files)) {
                // something has been changed, issue a request to update typings
                this.installer.enqueueInstallTypingsRequest(project, typingOptions);
                // Note: entry is now poisoned since it does not really contain typings for a given combination of compiler options\typings options.
                // instead it acts as a placeholder to prevent issuing multiple requests
                this.perProjectCache[project.getProjectName()] = {
                    compilerOptions: project.getCompilerOptions(),
                    typingOptions,
                    typings: result,
                    files: project.getFileNames(),
                    poisoned: true
                };
            }
            return result;
        }

        invalidateCachedTypingsForProject(project: Project) {
            const typingOptions = getTypingOptionsForProjects(project);
            if (!typingOptions.enableAutoDiscovery) {
                return;
            }
            this.installer.enqueueInstallTypingsRequest(project, typingOptions);
        }

        updateTypingsForProject(projectName: string, compilerOptions: CompilerOptions, typingOptions: TypingOptions, newTypings: string[], files: string[]) {
            this.perProjectCache[projectName] = {
                compilerOptions,
                typingOptions,
                typings: toTypingsArray(newTypings),
                files: files,
                poisoned: false
            };
        }

        onProjectClosed(project: Project) {
            delete this.perProjectCache[project.getProjectName()];
            this.installer.onProjectClosed(project);
        }
    }
}