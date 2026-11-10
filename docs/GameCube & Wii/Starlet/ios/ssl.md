# SSL

SSL provides the `/dev/net/ssl` device that games use for HTTPS. Taken from IOS36 IIRC.

The module performs RSA arithmetic in software on Starlet. The arithmetic is built from a small set of big number routines that store large values as word arrays, multiply them word by word and reduce the products with Montgomery reduction.

## Big numbers

A big number is described by a 16 byte structure. The structure points to an array of 32 bit words that holds the magnitude. A separate field records the sign.

| Offset | Size    | Field     | Meaning                                                     |
| ------ | ------- | --------- | ----------------------------------------------------------- |
| `0x00` | 4 bytes | Words     | Virtual pointer to the word array                           |
| `0x04` | 4 bytes | Used      | Number of words that make up the value, `0` for the value 0 |
| `0x08` | 4 bytes | Allocated | Number of words the array can hold                          |
| `0x0C` | 4 bytes | Negative  | Nonzero when the value is negative                          |

Most routines keep the used count tight. `bn_normalize` (`0x13CDEBD0`) walks down from the top of the value and drops every zero word it finds, so that the most significant used word is nonzero afterwards. `bn_num_bits` (`0x13CDEB30`) gives the bit length of a value. It counts 32 bits for every used word below the top one and adds the bit length of the top word itself. A value with no used words has a bit length of 0.

`bn_ucmp` (`0x13CDEDA4`) compares two magnitudes and ignores both sign fields. If the two values use a different number of words, it returns the difference `a.used - b.used` straight away, so callers can only rely on the sign of the result. If the counts match, it compares the words from the most significant end and returns `-1`, `0` or `1`.

`bn_lshift` (`0x13CDEE2C`) shifts a value left by any number of bits. The result keeps the sign of the input and is normalized before the function returns. `bn_usub` (`0x13CDE8B8`) subtracts one magnitude from another. It refuses the subtraction and returns `0` only when the second value uses more words than the first. When both use the same number of words, it subtracts without checking which one is larger, so the caller must make sure the first value is at least as large as the second.

## Word multiplication

Thumb code has no instruction that returns the upper half of a 32 bit by 32 bit product. The module therefore routes every word multiplication through `multiply_u64` (`0x13D041B0`), a general 64 bit multiply that returns the low 64 bits of the product.

To get the full 64 bit product of the two low words, the function splits each word into two 16 bit halves and multiplies the halves pairwise. That gives four partial products, which it adds together with the carries handled by hand. It then adds the two cross products between the low and high words of the inputs to the upper half of the result.

```c
uint64_t multiply_u64(uint64_t a, uint64_t b)
{
    uint32_t a_low = (uint32_t)a;
    uint32_t b_low = (uint32_t)b;

    uint32_t low_low = (a_low & 0xFFFF) * (b_low & 0xFFFF);
    uint32_t high_high = (a_low >> 16) * (b_low >> 16);

    // The first sum cannot overflow. Only the second addition can carry.
    uint32_t middle = (a_low & 0xFFFF) * (b_low >> 16) + (low_low >> 16);
    uint32_t cross = (a_low >> 16) * (b_low & 0xFFFF);
    middle += cross;
    if (middle < cross)
        high_high += 0x10000;

    uint32_t low = (middle << 16) + (low_low & 0xFFFF);
    uint32_t high = high_high + (middle >> 16)
                  + (uint32_t)(b >> 32) * a_low + b_low * (uint32_t)(a >> 32);
    return ((uint64_t)high << 32) | low;
}
```

`bn_mul_add_words` passes two 32 bit words with zero high words, so the cross products contribute nothing there. Every word product still costs a function call and six multiplications.

`bn_mul_add_words` (`0x13CF7144`) multiplies a whole word array by a single word and adds the result into another array, carrying from one word to the next. It calls `multiply_u64` once for every word and returns the carry out of the top word. When the count is not positive it returns `0` without doing anything. The loop is unrolled to handle four words per pass and behaves like the following code.

```c
uint32_t bn_mul_add_words(uint32_t* result, const uint32_t* words, int count, uint32_t multiplier)
{
    uint32_t carry = 0;

    for (int i = 0; i < count; i++) {
        uint64_t sum = (uint64_t)result[i] + multiply_u64(multiplier, words[i]) + carry;
        result[i] = (uint32_t)sum;
        carry = (uint32_t)(sum >> 32);
    }
    return carry;
}
```

## Montgomery reduction

Modular exponentiation in `bn_mod_exp_mont` (`0x13D01DCC`) produces products and squares that are twice as long as the modulus. It reduces them with `montgomery_reduce` (`0x13CF7FF8`), which brings a product of `2 * count` words back down to `count` words. The caller passes a reduction word `n0` along with the modulus.

The reduction works through the lower half of the product one word at a time. For each word, it multiplies the modulus by that word times `n0` and adds the result into the product, starting at the current word. The carry out of that addition goes into the corresponding word of the upper half. Any carry from there is kept for the next step. Once all lower words have been processed, the function treats the upper half as the result. If a carry is left over or the upper half is still at least as large as the modulus, it subtracts the modulus once with `bn_sub_words` (`0x13CF7420`). Otherwise it copies the upper half to the result unchanged.

```c
uint32_t carry = 0;

for (int i = 0; i < count; i++) {
    uint32_t added = bn_mul_add_words(&product[i], modulus, count, product[i] * n0) + carry;
    carry = added < carry;
    product[i + count] += added;
    if (product[i + count] < added)
        carry++;
}

uint32_t* high = &product[count];

// compare_words() compares two word arrays from the most significant word down.
if (carry != 0 || compare_words(high, modulus, count) >= 0)
    bn_sub_words(result, high, modulus, count);
else
    copy_words(result, high, count);
```

Because each of the `count` steps multiplies the full modulus, a single reduction makes `count * count` calls to `multiply_u64`. The cost therefore grows with the square of the key size which is insane for an interpreter lol. A 1024 bit modulus needs 1024 word multiplications per reduction, while a 4096 bit modulus needs 16384, sixteen times as many!!!

## Montgomery context

`bn_mont_ctx_set` (`0x13CF80B4`) prepares a Montgomery context for a modulus. The context keeps its own copy of the modulus, the modulus size in words and a precomputed value called RR.

| Offset | Size     | Field      | Meaning                                           |
| ------ | -------- | ---------- | ------------------------------------------------- |
| `0x08` | 4 bytes  | Word count | Modulus size in words, `(modulus bits + 31) / 32` |
| `0x0C` | 16 bytes | RR         | Big number `2^(64 * word count) mod N`            |
| `0x20` | 16 bytes | Modulus    | Big number holding a copy of the modulus N        |

RR is the square of `2^(32 * word count)` reduced modulo N. The function computes it directly. It sets a big number to exactly `2^(64 * word count)` by setting a single bit with `bn_set_bit` (`0x13CF8BC4`), reduces that number with `bn_mod_shift_subtract` and then pads the result with zero words up to the word count with `bn_pad_words` (`0x13CDEB88`).

## Shift-subtract reduction

`bn_mod_shift_subtract` (`0x13CF8778`) computes a remainder without any division. It repeatedly lines the modulus up under the top bit of the remaining value and subtracts it, much like long division done one bit at a time.

The function first handles two easy cases. If the value is already smaller than the modulus, it is copied to the result as it is. If the value has the same bit length as the modulus, one subtraction is enough. Otherwise the function copies the value into the result and starts the loop. In each pass it shifts the modulus left so that both numbers have the same bit length. If the shifted modulus turns out larger than the remainder, it shifts by one bit less. It then subtracts the shifted modulus from the remainder. In the code below, `copy` stands for `bn_copy` (`0x13CDEC9C`) and `shifted` is a temporary big number taken from the context.

```c
if (bn_ucmp(value, modulus) < 0) {
    copy(remainder, value);
    return 1;
}

int modulus_bits = bn_num_bits(modulus);
if (bn_num_bits(value) == modulus_bits) {
    bn_usub(remainder, value, modulus);
    return 1;
}

copy(remainder, value);
while (bn_ucmp(remainder, modulus) > 0) {
    int shift = bn_num_bits(remainder) - modulus_bits;
    bn_lshift(shifted, modulus, shift);
    if (bn_ucmp(shifted, remainder) > 0)
        bn_lshift(shifted, modulus, shift - 1);
    bn_usub(remainder, remainder, shifted);
}
return 1;
```

The loop only continues while the remainder is strictly greater than the modulus. If the remainder ever becomes exactly equal to the modulus, the function stops and returns the modulus itself instead of zero.

Every pass removes at least one bit from the remainder, so the loop runs at most `bits(value) - bits(modulus) + 1` times. Each pass shifts the entire modulus and subtracts across the entire remainder.
