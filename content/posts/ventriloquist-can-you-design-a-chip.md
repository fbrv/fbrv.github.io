+++
date = '2026-09-18T00:00:00Z'
draft = false
title = 'Ventriloquist: can you design a chip?'
description = 'Jane Street is running an ASIC design competition. Notes on what I am building for it.'
tags = ['asic', 'tiny-tapeout', 'rust', 'hardware']
+++

Recently I spent some time on a Jane Street challenge, ["Can you reverse engineer an ASIC?"](https://blog.janestreet.com/can-you-reverse-engineer-an-asic/). You get the GDS of a chip (the file with the actual layout, the one that goes to the foundry) and you have to work out what the circuit does and simulate it to find the input that makes it say success. I found it very interesting and it brought back things I thought I had lost a long time ago.  
Now there is a follow-up, ["Can you design a chip?"](https://blog.janestreet.com/protocol-emulator-asic-competition/):they want a protocol emulator (or that's what I understood): a small chip with a CPU in it, with an instruction set made for reading and writing pins, counting cycles and getting the timing right, so you can do UART, SPI and I2C in firmware instead of fixed logic. Those three are the minimum, low-speed USB and 10 Mbit Ethernet are stretch goals. They also suggest JTAG, SWD, PS/2 and CAN as other ones worth looking at and it should be able to run protocols nobody had in mind when it was designed. It gets made through [Tiny Tapeout](https://tinytapeout.com/) on IHP's 130 nm process, 24 tiles, which by their numbers is about 0.7 mm² and roughly 24 thousand logic cells. The Tiny Tapeout harness gives you 24 pins and a clock, which I am planning to run at 50 MHz, though so far the only thing I have shown will actually run that fast is a counter. Deadline is 18 January 2027, it has to be open source and they care about how you verify it as much as what it does. I'm going to give it a try, worst case the chip never gets fabricated. I decided to call the project Ventriloquist, since it is a chip that makes other devices talk.

I think the biggest problem is that a normal CPU cannot promise when a pin will change. You can get close with a tight loop that flips the pin and counts cycles, with everything else on the chip switched off so nothing interrupts it. People have done it for decades and it works but while that loop runs the processor does nothing else, so one protocol at a time and it breaks as soon as anything else needs attention. This is why microcontrollers have a separate little circuit for each protocol and the processor just hands them bytes. The competition says that this is not the point. Sure, sometimes you can trick one of those circuits into speaking something it was not designed for, the LED strips in every hobby project are usually driven by a circuit meant for a different protocol that happens to produce similar pulses, but it only works when the new protocol looks like the old one. If it looks like none of them there is nothing to trick.

What I am planning to do is to move the timing out of the CPU and into the pins. Every program has a time cursor on a 24-bit counter shared by every thread and any instruction can say "execute at cursor plus this delay". The CPU does not touch the pins. It passes the write to a pin cell together with the tick it should happen at and the pin cell applies it at that tick, whatever the CPU is doing at that moment. On the input side the pin cell records the time of every edge so the CPU sees "the line went low at tick 8201" instead of "the line is low". So the CPU can be late, it doesn't matter, the pin cell has the time. If it is so late that the tick has already passed, for example because it was blocked waiting for the host or for a pin, the write goes out immediately and the pin cell raises a missed-deadline signal, one per pin. How the program gets to see it I have not decided yet. The counter wraps every 335 ms at 50 MHz, which is longer than any protocol timeout and the compares are done so that wrapping doesn't matter. The CPU is a barrel processor: four hardware threads take turns on one datapath, one instruction each, so every thread gets an instruction every four cycles, 12.5 million a second and one thread cannot slow down another. Four is the plan but I'm not sure they all fit in the chip. Fewer threads means more instructions per thread, so all the numbers below only get better. The host talks to the chip over SPI to load programs and move bytes in and out. How many pins that leaves for protocols is still open.

For the instruction set I started from what a program actually needs to say for each of the protocols I care about and it turned out to be quite little. It has 13 instructions in 16-bit words, each with a 3-bit `at` prefix that selects a delay from a per-thread table of eight. Why a table and not a number in the instruction: after the prefix and a 4-bit opcode there are 9 bits left and delays go from a few cycles up to 1.25 million cycles for a 25 ms bus timeout, which is 21 bits, so they were never going to fit. The state of a thread is the cursor, that delay table, an outgoing and an incoming shift register, two small counters called x and y, a CRC register and a few flags. That is what `mov` copies between.

| group | instruction | what it does |
|---|---|---|
| time | `nop` | nothing, so with the `at` prefix it is a timed delay |
| | `sync` | move the cursor to now |
| | `sync ev` | move the cursor to the timestamp of the last edge on a pin |
| | `wait` | wait for a level or an edge, with a mandatory timeout |
| pins | `out` | put the next bits of the outgoing shift register on one or more pins |
| | `in` | read one or more pins into the incoming shift register |
| | `set` | load a constant: a pin high or low, a pin's drive mode (push-pull, open-drain where the pin only ever pulls low and a resistor pulls it up, which is what I2C needs, or off), or a loop counter |
| data | `mov` | copy between registers |
| | `jmp` | jump, always or on a condition, including decrement-and-branch |
| | `crc` | feed the bits just shifted into a serial CRC |
| host | `push` | send a word to the host FIFO |
| | `pull` | take a word from the host FIFO |
| threads | `irq` | set, clear or wait on a flag shared between threads |

This is the UART transmitter, the whole program. `D[1]` is the bit period, which the host sets. `pull` loads the outgoing shift register from the host FIFO and `out` shifts bits from it onto a pin. `at +1` means "one bit period after the cursor". Here that is the same as one period after the previous edge because every instruction in the chain has it, except `at +1 nop`, which moves the cursor without any edge:

```asm
        sync                 ; cursor := now
        set pin 0 high       ; line idles high
        set dir 0 pushpull
tx:
        pull                 ; wait for a byte from the host
        set x 7              ; 8 data bits: jmp x-- runs the body 8 times
        sync
        at +1 set pin 0 low  ; start bit
bit:
        at +1 out 0 1        ; pin 0, one bit, one per period, LSB first
        jmp x-- bit
        at +1 set pin 0 high ; stop bit
        at +1 nop            ; hold it a full period
        jmp tx
```

There is no arithmetic apart from decrement-and-branch, no memory access, no call and return, but I might change my mind on some of that once I have real numbers for what things cost. A protocol program does not compute anything, it moves bits between pins and shift registers at the right moments, so what it needs is a way to say when. Every instruction costs cells, so an instruction gets in only when a protocol cannot be written without it. `sync ev` is there because UART receive has to sample relative to the real edge of the start bit and not relative to when the program noticed it. Call and return is not there because I2C, the most awkward of the required protocols, fits in 124 of the 128 words a thread can address without it. By the way, four threads times 128 words of 16 bits is exactly one of the 1 KB SRAM macros the process offers.

`crc` is the one I went back and forth on. CAN and USB need a checksum in the middle of a frame, so the host cannot do it. Doing it in software would need an `xor`, a shift that doesn't touch the pins, a branch on a single bit and a third register for the polynomial. That is more silicon than the CRC unit itself and it would take about ten instructions per bit instead of one. At 1.5 Mbit/s low-speed USB a thread gets eight instructions per bit, so the software version does not fit and the unit stays.

Since I'm counting instructions per bit, here are the numbers for the required protocols. UART at 115200 gets about a hundred instructions per bit and I2C at 400 kHz about thirty, so no problem there. SPI is the tight one. One bit of an SPI master looks like this:

```asm
        at +1 set pin 0 low  ; clock low
        out 1 1              ; data bit on pin 1
        at +1 set pin 0 high ; clock high, the other side samples here
        in 2 1               ; read its bit back
        jmp x-- bit
```

Five instructions, so with a thread issuing 12.5 million a second the clock tops out around 2.5 MHz, a bit more if you don't need to read anything back. Enough for most SPI devices but not all of them. If that becomes a problem the fix is a side-set field, so that `out` can move the clock and the data in one instruction. 10 Mbit Ethernet is out of reach for the core at this clock, less than two instructions per bit, so its CRC-32 stays on the host if Ethernet happens at all.

None of the pieces are new. The PIO blocks in the RP2040 do the same job, [FlexPRET](https://ptolemy.berkeley.edu/projects/chess/pubs/1048.html) is a barrel processor with deadline instructions, XMOS has had timed ports for years (their `out port @ time` is almost exactly the cursor idea) and the Propeller 2 has smart pins. What none of them have is all of this together with the protocol written as an automaton that a model checker has looked at before it runs and that is the part I am interested in.

The part I actually want to play with is how the protocols get written. Instead of assembly I want a small DSL where you say things like wait for the clock to go high, then after this delay set the data pin and so on. That compiles to a timed automaton ([Alur and Dill, 1994](https://doi.org/10.1016/0304-3975(94)90010-8)) which gets lowered to the instructions above, but the same automaton can also go to a model checker. So before a protocol ever runs I can ask if it can deadlock, if every wait is bounded, if the I2C master always lets go of the bus even when the slave stretches the clock and then stops answering and I get an answer for every possible interleaving instead of the handful my tests happen to hit.

I'm trying to do the same on the hardware side. The chip is not hand-written Verilog but a Rust program that builds the circuit and writes out the Verilog for the tools and a simulator for the tests, from the same description. Then I use [SymbiYosys](https://github.com/YosysHQ/sby), a formal verification tool for Verilog, to prove the few properties everything else depends on instead of checking them on a handful of test programs. The main one is that if an instruction asks for a pin change at tick N, the pin changes at tick N, whichever turn the thread got, as long as the thread is not stuck waiting. A thread can get stuck in a `wait` on a pin, in a `pull` on the host or in an `irq` on another thread. The first case is what the model checker takes care of on the automaton side when it proves every wait is bounded. The other two are outside the automaton, so there is a rule for programs: block on the host or on another thread only when no deadline is pending, like the UART program does with its `pull` before the `sync`. With that rule the two proofs together cover the whole path from the protocol description to the pin. There is also one thing in the pin cells I have not talked about here, because I don't know yet if the tools will let me build it. I will write about it when I have numbers.

They also say that verification matters more as AI-assisted chip design becomes common. I agree, so I am using more than one LLM (a combination of Claude Opus and OAI Astra) for two jobs, drafting properties and planting bugs in the Verilog. Proving a drafted property does not tell me it was worth stating, a weak or vacuous one proves just fine, that is what the planted bugs are for. If the property set does not catch them it is not doing its job. I will report which of the planted bugs got through.

More as it goes. If you have opinions, especially on the formal side, I would like to hear them.

---

References: Zimmer, Broman, Shaver and Lee, [FlexPRET](https://ptolemy.berkeley.edu/projects/chess/pubs/1048.html), RTAS 2014. Edwards and Lee, [The Case for the Precision Timed (PRET) Machine](https://www.cs.columbia.edu/~sedwards/papers/edwards2007case.pdf), DAC 2007. David May, [The XMOS XS1 Architecture](https://docs.alexrp.com/xcore/xmos_xs1.pdf), 2009. [RP2040 datasheet](https://datasheets.raspberrypi.com/rp2040/rp2040-datasheet.pdf), chapter 3. Alur and Dill, [A theory of timed automata](https://doi.org/10.1016/0304-3975(94)90010-8), 1994. [Tiny Tapeout](https://tinytapeout.com/), [IHP Open PDK](https://github.com/IHP-GmbH/IHP-Open-PDK).
