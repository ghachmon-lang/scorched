// "Talking tanks": what the tanks say. Picked deterministically via the game RNG.
export const TAUNTS = {
  hit: [
    'OUCH!', 'THAT HURT!', 'HEY!', 'NOT AGAIN!', "I'LL GET YOU FOR THAT!", 'YOU MISSED... MOSTLY',
    'IS THAT ALL YOU GOT?', 'MEDIC!', 'MY PAINT JOB!', 'RUDE.', 'OW OW OW', 'WHO DID THAT?!',
    'MOMMY!', 'STOP IT!', 'THAT TICKLED', 'CHEAP SHOT!', 'REVENGE IS COMING',
  ],
  self: [
    'OOPS.', 'WHO PUT THAT THERE?', 'I MEANT TO DO THAT', 'NOTE TO SELF: AIM UP', 'THIS IS FINE.',
    "DON'T LOOK AT ME", 'THE WIND DID IT', 'WELL. THAT WAS DUMB.',
  ],
  miss: [
    'HA! MISSED!', 'NOT EVEN CLOSE', 'NICE TRY', 'I FELT THE BREEZE', 'TOO SLOW!', 'PATHETIC.',
    'WAS THAT AIMED AT ME?', 'BOO!',
  ],
  kill: [
    'GOTCHA!', 'BOOM.', 'NEXT!', 'SAY GOODNIGHT', 'ONE DOWN', 'HASTA LA VISTA', 'THAT WAS EASY',
    'WHO ELSE WANTS SOME?', 'EAT DIRT!', 'BULLSEYE!',
  ],
  death: [
    'GOODBYE CRUEL WORLD', 'TELL MY WIFE I LOVE HER', 'I REGRET NOTHING', 'AVENGE ME!', 'ARRGH!',
    'SO THIS IS HOW IT ENDS', 'MOTHER!', 'I SEE A LIGHT...', 'NOOOOO!', "IT'S ONLY A FLESH WOUND",
    'BLIMEY', 'SEE YOU IN HELL', 'ROSEBUD...', 'I DIE FREE!', 'WORTH IT.',
  ],
  win: [
    'VICTORY IS MINE!', 'LAST TANK STANDING', 'ALL TOO EASY', 'KING OF THE HILL', 'GG',
    'IS THAT IT?', 'I AM INEVITABLE',
  ],
  fall: [
    'WHOA!', 'GOING DOWN', 'MY STOMACH!', 'AAAAAAAAH', 'CATCH ME!', 'WHEEEE',
  ],
  buried: [
    "IT'S DARK IN HERE", 'HELLO? ANYONE?', 'I NEED A SHOVEL', 'DIRT. GREAT.',
  ],
};

export function pickTaunt(rng, kind) {
  const list = TAUNTS[kind] || TAUNTS.hit;
  return list[rng.int(list.length)];
}
