<script lang="tsx">
import { defineComponent } from 'vue';
import { UserProfile, UserAvatar } from '@zsfe/zsui';

export default defineComponent({
    props: {
        user: Object,
    },
    setup(props) {
        const renderUser = () => {
            if (!props.user?.name) return '';

            return (
                <div class="flex items-center">
                    <UserProfile username={props.user?.name}>
                        {{
                            user: () => (
                                <div class="inline-flex items-center">
                                    <UserAvatar username={props.user?.name} showText={false} />
                                    <span class="ml-2 text-[#646a73]">{props.user?.name}</span>
                                </div>
                            ),
                            profile: () => (
                                <div class="p-[15px]">
                                    你好， 欢迎访问我的主页
                                </div>
                            ),
                        }}
                    </UserProfile>
                </div>
            );
        };

        return () => renderUser();
    }
});
</script>

<style scoped>
</style>