import { BaseCommand } from '../baseCommand.js';
import * as API from '../utils/api.js';
import * as fs from 'fs';
import * as path from 'path';

//import CastleCore from '../../assets/castle-core-loader.cjs';


export default class Player extends BaseCommand<typeof Player> {
  static description = 'Test the player';
  static hidden = true;

  public async run(): Promise<void> {
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
