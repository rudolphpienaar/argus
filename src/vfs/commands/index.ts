import type { BuiltinDeps, BuiltinHandler } from './types.js';
import { command as cd } from './cd.js';
import { command as ls } from './ls.js';
import { command as pwd } from './pwd.js';
import { command as cat } from './cat.js';
import { command as echo } from './echo.js';
import { command as mkdir } from './mkdir.js';
import { command as touch } from './touch.js';
import { command as rm } from './rm.js';
import { command as cp } from './cp.js';
import { command as mv } from './mv.js';
import { command as ln } from './ln.js';
import { command as tree } from './tree.js';
import { command as env } from './env.js';
import { command as exportCommand } from './export.js';
import { command as whoami } from './whoami.js';
import { command as wc } from './wc.js';
import { command as date } from './date.js';
import { command as history } from './history.js';
import { command as help } from './help.js';
import { command as python } from './python.js';
import { command as upload } from './upload.js';

const COMMANDS = [
    cd,
    ls,
    pwd,
    cat,
    echo,
    mkdir,
    touch,
    rm,
    cp,
    mv,
    ln,
    tree,
    env,
    exportCommand,
    whoami,
    wc,
    date,
    history,
    help,
    python,
    upload
];

/**
 * Build builtin command handler registry for shell dispatch.
 *
 * @param deps - Shared dependencies injected into each builtin factory.
 * @returns Command-name keyed handler registry.
 */
export function registry_create(deps: BuiltinDeps): Record<string, BuiltinHandler> {
    const registry: Record<string, BuiltinHandler> = {};
    for (const command of COMMANDS) {
        registry[command.name] = command.create(deps);
    }
    return registry;
}
