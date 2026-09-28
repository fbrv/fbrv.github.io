+++
date = '2026-09-28T00:00:00Z'
draft = true
title = 'Ventriloquist: how the processor is put together'
description = 'The core of the protocol-emulator chip exists and has been through the layout tools. How four threads ended up sharing one datapath, what it cost, and what the tools found.'
tags = ['asic', 'tiny-tapeout', 'rust', 'hardware']
+++

In the first post I described the processor as a barrel with four threads, one instruction each every four cycles, and said I wasn't sure all four would fit in the chip. Now it's built and has been through the layout tools on the IHP process several times, so I have real sizes and real timing instead of guesses, and along the way I changed my mind about how the threads are stored, which is the part I actually want to write about. This is the whole chip as it stands, boxes only:

```
   host, over SPI
        |
        v
  +---------------+   next word   +-----------------+          +------------------+
  | program store |-------------->|                 |  writes  |  8 timed pins    |
  |  (1 KB SRAM)  |               |    the one      |--------->|  8 plain pins    |---> 24 pins
  +---------------+               |    datapath     |<---------|  (each pin cell  |<---
                                  |                 |  edges   |   has its own    |
  +-----------------------------+ |                 |          |   little clock)  |
  | T3 | T2 | T1 | T0 <- serving |<+                 |          +------------------+
  +-----------------------------+ +-----------------+                  ^
     four copies of the state,                                         |
     turning one step per tick               one shared 24-bit tick counter
```

The first number was not great. A single thread came out at 7020 standard cells placed and routed, 10.6% of the tile, against the 2000 I had budgeted, so three and a half times off, which for a first estimate is about what I deserved. The plan had a fallback for exactly this ("drop to 2 or 3 threads") and for a day or two I thought I'd be using it. I didn't, because those cells are logic, and in a barrel the logic exists once: the threads take turns on it, one instruction each per 20 ns tick, so each one issues every 80 ns whatever the others are doing. What has to exist four times is only the state a thread carries between turns, program counter, cursor, delay table, two shift registers, x, y, the CRC and some flags, 410 bits. I knew that when I wrote the plan, I just hadn't measured how lopsided logic and state were, and it turns out very.

What I hadn't thought about at all is how the datapath gets at the right thread's state on each tick. The way I'd assumed, without ever writing it down, is four copies of every register and a multiplexer on every wire the datapath reads. A few gates per bit, no big deal, except they land at the start of the slowest paths in the design, from the delay table into the compare against the counter, so they eat straight into the margin at 50 MHz. The alternative is to not select at all: make every register a ring of four, let the datapath read and write position 0 only, and shift the ring one position every tick. A thread's state gets written at the end of its turn, goes round the back over the next three ticks and is at position 0 again exactly when its turn comes round.

```
tick n      position 0    position 1    position 2    position 3
            [ T0 state ]  [ T1 state ]  [ T2 state ]  [ T3 state ]
                 ^
            the datapath reads and writes here, and only here

tick n+1    [ T1 state ]  [ T2 state ]  [ T3 state ]  [ T0 state ]
                                                       (updated, on
                                                        its way round)
```

At four threads the multiplexer version synthesises to 9491 cells and the ring to 6371 (the synthesis tool's own count, before layout roughly doubles it), and each thread you add to the ring costs 915 of those, most of which are the 410 flops themselves. It's not a new trick, but I was quite pleased with it for an afternoon.

The ring isn't free though, and it was the layout tool that told me, not me. Each bit is a flip-flop feeding the next with no logic in between, and a flop needs its input to stay put for a moment after the clock edge (the hold time), so the tool inserts delay buffers on those paths, about 3000 of them, an eighth of the standard-cell area, still cheaper than the multiplexers. It does mean every bit I add to a thread is a flop, a buffer and wiring, times four, so the 410 bits are frozen now, and I've already caught myself twice wanting one more.

The program is in a 1 KB SRAM macro, 512 words of 16 bits, and its clock-to-output is 6.61 ns out of the 20 ns tick at the slow corner (the tools' worst case for process, voltage and temperature), too much to decode in what's left, so a thread's word is fetched two ticks before its turn and held in a register. With the ring, who is up in two ticks is whoever sits at position 2. The macro has never been on silicon in this process (nobody has taped it out on this particular flavour of the IHP node yet, as far as I can tell), so there's a fallback that feeds the program a byte at a time over the pins, at a third of the speed. I built it, tested it, and I would very much like to never use it.

Timing didn't change since the first post, which was a relief: one 24-bit counter for the whole chip, a cursor per thread, and a write to a pin is a level plus a tick (`cursor + D[k]`) handed to the pin cell, which applies it when the counter gets there. The open question was how many pending writes a pin cell needs to buffer. It's one, and the argument is short enough that I like it: a thread can post a write at most four ticks before it's due and doesn't get another turn for four ticks, so the first write has gone out before a second can be posted. That needs one thread per pin, so the host assigns pins before it starts anything and a write from the wrong thread is refused and flagged.

```
tick        0     1     2     3     4     5     6     7     8
T0's turn   *                       *                       *
            |                       |
            posts "pin high at 3"   posts "pin low at 7"
                              |                       |
pin cell                      high                    low
```

Before the barrel existed I ran four copies of the single-thread design through the flow together, to see whether that much logic would route at all. It routed, and missed 50 MHz by 0.42 ns at the slow corner, and I spent a while blaming the design before it turned out to be the tool: the step that resizes gates was working with a wire capacitance from the process kit that is about half of what the finished layout measures, so it saw no problem and did nothing. With that figure scaled by 2.1 the same design closed at +0.62 ns. The real chip, four threads, the SRAM, sixteen protocol pins and the SPI link, closes at +1.94 ns, fills 44.2% of the tile, and ran a UART transmitter and an I2C EEPROM on two threads at once on the gate-level netlist, the circuit as it comes out of layout.

In the first post I said I might change my mind about having no arithmetic once I had numbers, and the device side looked like the place it would happen: an I2C target has to check whether the address on the bus is its own, and nothing in the ISA compares two values. There is `wait` on a pin with a timeout of zero, then `jmp` on the timeout flag, which tests one bit as it arrives, so the address check is unrolled, four words per bit, and the ISA stayed as it was. Whether a small ALU is worth its silicon is a study I've scheduled for later on, same rule as before: nothing goes in unless a protocol can't be written without it. I keep going back and forth on this one.

The thing I left out of the first post is in the pin cells: a chain of delay gates on the input pin, each sampled by a flip-flop at the clock edge, so counting how many have switched tells you how far into the tick the edge arrived. I was fairly sure the tools would look at a chain of buffers doing nothing and helpfully remove it; they didn't, and 44 taps of two gates each cover the 20 ns tick at 0.735 ns per tap. More on that once I've calibrated it. As before, if you have opinions I'd like to hear them.
