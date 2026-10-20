// Both channels share one sequence. An old unordered hover must never undo the
// position attached to a later reliable click or drag.
export class PointerOrder {
  constructor(){this.last=0;this.sequenced=false;}
  accept(command,fast=false){
    if(command?.type!=='move')return false;
    if(!Number.isFinite(command.x)||command.x<0||command.x>1||!Number.isFinite(command.y)||command.y<0||command.y>1)return false;
    if(command.seq===undefined)return !fast&&!this.sequenced;
    if(!Number.isSafeInteger(command.seq)||command.seq<=this.last)return false;
    this.last=command.seq;this.sequenced=true;return true;
  }
}
