<script setup>
import { ref } from 'vue'

const message = ref('probe-ok')
</script>

<template>
  <div class="probe">{{ message }}</div>
</template>
