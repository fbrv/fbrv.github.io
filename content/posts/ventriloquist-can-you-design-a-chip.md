+++
date = '2026-09-18T00:00:00Z'
draft = false
title = 'Can you design a chip?'
description = 'Jane Street is running an ASIC design competition. Notes on what I am building for it.'
tags = ['asic', 'tiny-tapeout', 'rust', 'hardware']
+++

Recently I spent some time on a Jane Street challenge, ["Can you reverse engineer an ASIC?"](https://blog.janestreet.com/can-you-reverse-engineer-an-asic/). You get the GDS of a chip, and you have to work out what the circuit does and simulate it to find the input that makes it say success. I found it very interesting and it brought back things I thought I had lost a long time ago.  
Now there is a follow-up, ["Can you design a chip?"](https://blog.janestreet.com/protocol-emulator-asic-competition/). As far as I understand it they want a protocol emulator: a small chip with a tiny CPU in it, with an instruction set made for reading and writing pins, counting cycles and getting the timing right, so you can do UART, SPI and I2C in firmware instead of fixed logic. Those three are the minimum, low-speed USB and 10 Mbit Ethernet are stretch goals and it should be able to run protocols nobody had in mind when it was designed. It gets made through [Tiny Tapeout](https://tinytapeout.com/) on IHP's 130 nm process, so about 0.9 mm², roughly 24 thousand logic cells, 24 pins, 50 MHz. Deadline is 18 January 2027, it has to be open source, and they care about how you verify it as much as what it does. I'm going to give it a try, worst case the chip never gets printed.

I think the biggest problem is that a normal CPU cannot say when a pin will change: a loop that toggles a pin every 434 cycles will sometimes do it at 435 or 437, because an interrupt came in or a cache missed, and on a serial line a late edge is a wrong byte. That is why every microcontroller has one hardware peripheral per protocol, which is exactly what the competition says is not the point: UART, SPI and I2C blocks on one die would not be able to speak a protocol invented after the chip was made.

What I am planning to do is moving the timing out of the CPU and into the pins. Every program has a time cursor on a counter shared by the chip and any instruction can say "execute at cursor plus this delay". The CPU does not touch the pins: it passes the write to a pin cell together with the tick it should happen at and the pin cell applies it at that tick whatever the CPU is doing. On the input side the pin cell records the time of every edge, so the CPU sees "the line went low at tick 8201" rather than "the line is low". The CPU can be late, the timing is decided at the pin. The CPU is a barrel processor, a few hardware threads taking turns on one datapath, so one cannot slow down another.

The instruction set came out after thinking about what a program actually needs to say for each of the protocols I care about, and it turned out to be quite minimal. It has 13 instructions in 16-bit words, each with a 3-bit `at` prefix that selects a delay from a per-thread table.

| | instruction | what it does |
|---|---|---|
| time | `nop` | nothing, so with the `at` prefix it is a timed delay |
| | `sync` | move the cursor to now |
| | `sync ev` | move the cursor to the timestamp of the last edge on a pin |
| | `wait` | wait for a level or an edge, with a mandatory timeout |
| pins | `out` | put the next bits of the outgoing byte on one or more pins |
| | `in` | read one or more pins into the incoming byte |
| | `set` | load a constant: a pin high or low, a pin's drive mode (push-pull, open-drain, off), or a loop counter |
| data | `mov` | copy between registers |
| | `jmp` | jump, always or on a condition, including decrement-and-branch |
| | `crc` | feed the bits just shifted into a serial CRC |
| host | `push` | send a word to the host FIFO |
| | `pull` | take a word from the host FIFO |
| threads | `irq` | set, clear or wait on a flag shared between threads |

This is the UART transmitter, the whole program. `D[1]` is the bit period, which the host sets, and `at +1` means "one bit period after the previous edge":

```asm
        sync                 ; cursor := now
        set pin 0 high       ; line idles high
        set dir 0 pushpull
tx:
        pull                 ; wait for a byte from the host
        set x 7              ; 8 data bits
        sync
        at +1 set pin 0 low  ; start bit
bit:
        at +1 out 0 1        ; one data bit per period, LSB first
        jmp x-- bit
        at +1 set pin 0 high ; stop bit
        at +1 nop            ; hold it a full period
        jmp tx
```

There is no arithmetic apart from decrement-and-branch, no memory access, no call and return. I might change my mind on some of that once I have real numbers for what things cost. A protocol program does not compute anything, it moves bits between pins and shift registers at the right moments, so what it needs is a way to say when. Every instruction costs cells, so one gets in only when a protocol cannot be written without it. `crc` is there because CAN and USB need a checksum in the middle of a frame (doing it in software would need an `xor`, a shift that doesn't touch the pins, a branch on a single bit and a third register for the polynomial, which is more silicon than the CRC unit itself and about ten instructions per bit instead of one, too slow for USB). `sync ev` is there because UART receive has to sample relative to the start bit's real edge, not relative to when the program noticed it. Call and return is not there because I2C, the most awkward of the required protocols, fits in 124 of the 128 words a thread can address without it.

None of this is new. The PIO blocks in the RP2040 do the same job, [FlexPRET](https://ptolemy.berkeley.edu/projects/chess/pubs/1048.html) is a barrel processor with deadline instructions, XMOS has timed ports and the Propeller 2 has smart pins.

The part I actually want to play with is how the protocols get written: instead of assembly I want to build a small DSL where you say things like wait for the clock to go high, then after this delay set the data pin and so on. That compiles to a timed automaton ([Alur and Dill, 1994](https://doi.org/10.1016/0304-3975(94)90010-8)) which gets lowered to the instructions above but the same automaton can also go to a model checker. So before a protocol ever runs I can ask whether it can deadlock, whether every wait is bounded, whether the I2C master always lets go of the bus even when the slave stretches the clock and then stops answering and get an answer for every possible interleaving instead of the handful my tests happen to hit. I'm trying to do the same on the hardware side: the chip is not hand-written Verilog but it's a Rust program that builds the circuit and writes out the Verilog for the tools and a simulator for the tests from the same description. Then I use SymbiYosys to prove the few properties everything else depends on, instead of checking them on a handful of test programs. The main one is that if an instruction asks for a pin change at tick N, the pin changes at tick N, whichever turn the thread got. There is also one thing in the pin cells I have not talked about here, because I don't know yet if the tools will let me build it, I will write about it when I have numbers. Since they asked how people would use LLMs, I am using 1+ (probably a conbination  Claude Opus an OAI Astra) to draft properties and to plant bugs in the RTL, with the rule that nothing it writes is trusted until it's proved and I will report which of the planted bugs got through.

More as it goes. If you have opinions, especially on the formal side, I would like to hear them.

---

References: Zimmer, Broman, Shaver and Lee, [FlexPRET](https://ptolemy.berkeley.edu/projects/chess/pubs/1048.html), RTAS 2014. Edwards and Lee, [The Case for the Precision Timed (PRET) Machine](https://www.cs.columbia.edu/~sedwards/papers/edwards2007case.pdf), DAC 2007. David May, [The XMOS XS1 Architecture](https://docs.alexrp.com/xcore/xmos_xs1.pdf), 2009. [RP2040 datasheet](https://datasheets.raspberrypi.com/rp2040/rp2040-datasheet.pdf), chapter 3. Alur and Dill, [A theory of timed automata](https://doi.org/10.1016/0304-3975(94)90010-8), 1994. [Tiny Tapeout](https://tinytapeout.com/), [IHP Open PDK](https://github.com/IHP-GmbH/IHP-Open-PDK).
