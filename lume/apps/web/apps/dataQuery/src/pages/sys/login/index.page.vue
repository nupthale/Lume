<script setup lang="ts">
  import { computed } from 'vue';
  import { Tabs, TabPane, Form, FormItem, Input, InputPassword, Button, Space } from 'ant-design-vue';
  import { isEmpty } from 'lodash-es';

  import { updateInputCode$, login$ } from '@/store/subscriptions/login/observables/index';
  import { useLoginStore } from '@/store/ui-states/login/index';
  import { useRandCode } from '@/store/queries/login/useRandCode';

  const { loginForm, setLoginForm } = useLoginStore();

  const { randCodeImgSrc } = useRandCode();

  const submitDisabled = computed(() => {
    return isEmpty(loginForm.account) || isEmpty(loginForm.password) || isEmpty(loginForm.inputCode);
  });

  const handleUpdateCheckCode = () => updateInputCode$.next({});
  const handleLogin = () => {
    if (!submitDisabled.value) {
      login$.next(loginForm);
    }
  };

  const handleFormChange = (values) => {
    setLoginForm(values);
  };
</script>

<template>
  <div class="login-bg"></div>

  <div class="login-container">
    

    <div class="login-left">
      <div class="login-illustration">
        <div class="login-logo"></div>
        <div class="loginCircles">
          <div class="loginCircle-1"></div>
          <div class="loginCircle-2"></div>
          <div class="loginCircle-3 glass"></div>
          <div class="loginCircle-4"></div>
        </div>

        <div class="relative">
          <div class="login-titleTag">让工作更简单、更高效</div> 
          <div class="login-largeTitle">效率为本，</div>
          <div class="login-largeTitle">企业决策基石</div>
          <div class="login-lightTitle">数据驱动、智能技术赋能，协同合作加速，创新引领变革，提效驱动增长</div>
        </div>
      </div>
    </div>
    <div class="login-right">
      <div class="login-main">
        <div style="margin-top: -180px">
          <h1 class="login-title">欢迎使用智能问数</h1>
          <Tabs>
            <TabPane key="1" tab="账号登录">
              <Form class="login-form" @change="handleFormChange">
                <FormItem name="account">
                  <Input addonBefore="账号" v-model:value="loginForm.account" size="large" placeholder="请输入你的账号" />
                </FormItem>

                <FormItem name="password">
                  <InputPassword addonBefore="密码" v-model:value="loginForm.password" size="large" placeholder="请输入你的密码" />
                </FormItem>

                <Space class="login-inputCode flex items-start w-full">
                  <FormItem name="inputCode">
                    <Input v-model:value="loginForm.inputCode" size="large" placeholder="请输入验证码" />
                  </FormItem>
                  <img class="login-inputCode__img" :src="randCodeImgSrc" @click="handleUpdateCheckCode" />
                </Space>

                <Button type="primary" size="large" block @click="handleLogin" html-type="submit">登录</Button>
              </Form>
            </TabPane>
          </Tabs>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
  .glass {
    width: 100px;
    height: 100px;
    border-radius: 100%;
    position: relative;
    background: rgba(255, 255, 255, 0.15);
    backdrop-filter: blur(2px) saturate(180%);
    border: 1px solid rgba(255, 255, 255, 0.8);
    box-shadow: 0 8px 32px rgba(31, 38, 135, 0.2), 
                inset 0 4px 20px rgba(255, 255, 255, 0.3);
  }

  .glass::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    border-radius: 100%;
    backdrop-filter: blur(1px);
    box-shadow: inset -10px -8px 0px -11px rgba(255, 255, 255, 1),
                inset 0px -9px 0px -8px rgba(255, 255, 255, 1);
    opacity: 0.6;
    z-index: -1;
    filter: blur(1px) drop-shadow(10px 4px 6px black) brightness(115%);
  }

  .login-bg {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 0;
  }

  .login-titleTag {
    display: inline-block;
    padding: 6px 12px;
    background: #34c72433;
    color: #237b19;
    font-size: 18px;
    line-height: 26px;
    font-weight: 500;
    margin-bottom: 18px;
    border-radius: 6px;
  }

  .login-largeTitle {
    font-size: 40px;
    line-height: 56px;
    font-weight: 600;
  }

  .login-lightTitle {
    margin: 24px 0;
    color: #646a73;
    font-size: 18px;
    line-height: 26px;
  }

  .loginCircles {
    position: absolute;
    width: 680px;
    height: 680px;
    top: -200px;
    left: -150px;
  }

  .loginCircle-1 {
    position: absolute;
    top:0;
    left:0;
    width: 100%;
    height: 100%;
    background: url('../../../assets/loginCircle1.svg') no-repeat;
  }

  .loginCircle-2 {
    position: absolute;
    top: 82px;
    left: 3px;
    width: 100%;
    height: 100%;
    background: url('../../../assets/loginCircle2.svg') no-repeat;
  
    transform: rotate(0deg);
    transform-origin: 320px 228px;

    animation: loginCircle2Rotate 3s linear infinite forwards;
  }

  @keyframes loginCircle2Rotate {
    0% {
      transform: rotate(0deg);
    }

    50% {
      transform: rotate(-15deg);
    }

    100% {
      transform: rotate(0deg);
    }
  }

  .loginCircle-3 {
    position: absolute;
    top: 82px;
    right: -30px;
    background: #ffffffbd;
    width: 200px;
    height: 200px;
    border-radius: 100%;
    opacity: 0.5;
    animation: semicircleAnimation 6s linear infinite forwards;
    transform: rotate(-10deg);
    transform-origin: -292px 437px;
    backdrop-filter: blur(8px);
  }

  @keyframes semicircleAnimation {
    0% {
      transform: rotate(-10deg);
    }

    50% {
      transform: rotate(0);
    }

    100% {
      transform: rotate(-10deg);
    }
  }

  .loginCircle-4 {
    position: absolute;
    bottom: 62px;
    left: 82px;
    background: linear-gradient(to right, #eeeeee, #9ca3e3bd);
    width: 82px;
    height: 122px;
    border-radius: 40px;
    opacity: 0.6;
    animation: insetSlicdeUp 3s ease-in-out infinite forwards;
    transform: translateY(0) rotate(45deg);
  }

  @keyframes insetSlicdeUp {
    0% {
      transform: translateY(0) rotate(45deg);
    }

    50% {
      transform: translateY(-35%) rotate(45deg);
    }

    100% {
      transform: translateY(0) rotate(45deg);
    }
  }

  .login-container {
    position: relative;
    display: flex;
    width: 100%;
    height: 100%;
    font-family: BlinkMacSystemFont,SF Pro Display,PingFang SC,方正兰亭黑Pro_GB18030,Microsoft Yahei;

    margin: 0 auto;
  }

  .login-logo {
    position: absolute;
    top: -160px;
    left: 0;
    width: 150px;
    height: 41px;
    background: url('../../../assets/logo-dark.png') no-repeat;
    background-size: contain;
    z-index: 9;
  }

  .login-left,
  .login-right {
    display: flex;
    align-items: center;
  }

  .login-left {
    position: relative;
    width: 50%;
    background: url('../../../assets/loginBg.png');

    @media screen and (max-width: 1200px) {
      display: none;
    }
  }

  .login-right {
    width: 50%;

    @media screen and (max-width: 1200px) {
      width: 100%;
    }
  }

  .login-illustration {
    position: absolute;
    left: calc(50% - 432px / 2);
    top: calc(50% - 300px / 2);

    width: 432px;

    background-size: contain;
  }

  .login-main {
    width: 544px;
    height: 100%;
    padding: 40px;

    display: flex;
    align-items: center;
    justify-content: center;
    border-left: 1px solid #dee0e3;
  }

  .login-title {
    font-size: 22px;
    font-weight: 600;
    line-height: 30px;
    color: #1f2329;

    margin-bottom: 24px;
  }

  .login-form {
    margin-top: 16px;
  }

  .login-form :deep(.ant-input-group-addon) {
    background: #fff;
  }

  .login-inputCode__img {
    width: 105px;
    cursor: pointer;
  }
</style>

<style lang="less">
  .login-inputCode {
    align-items: flex-start !important;

    .ant-space-item:first-of-type {
      flex: 1;
    }
  }
</style>
