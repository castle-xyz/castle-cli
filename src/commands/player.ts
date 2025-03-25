import { Command } from '@oclif/core';
import * as API from '../utils/api.js';
import * as fs from 'fs';
import * as path from 'path';

//import CastleCore from '../../assets/castle-core.cjs';


export default class Player extends Command {
  static description = 'Test the player';
  static hidden = true;

  public async run(): Promise<void> {
    // @ts-ignore
    /*window.Module = {
      locateFile: (path, scriptDirectory) => {
        console.log(`Locating file: ${path}`);
        console.log(`Script directory: ${scriptDirectory}`);
        return path;
      },
    };*/

    //CastleCore();

    /*
    const binary = fs.readFileSync('/Users/jesseruder/castle/castle-cli/assets/castle-core.wasm');

    var asmLibraryArg = {
    };
    let module = await WebAssembly.instantiate(binary, {
      a: asmLibraryArg,
    });

    console.log(module);*/
  }
}
